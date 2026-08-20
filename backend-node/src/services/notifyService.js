'use strict';

const { DEFAULT_PAGE_SIZE } = require('../constants/pagination');

/**
 * Sprint 18 - S18-T02 报表推送通知服务
 *
 * 能力：
 *   - sendEmail()：SMTP 发送（nodemailer；支持 json transport 供测试，不真正联网）
 *   - sendDingtalk()：钉钉机器人 webhook（支持加签）
 *   - dispatch()：按订阅接收渠道分发报表 + 写 report_send_log
 *   - retryFailed()：失败记录重试（最多 max_attempts 次，间隔 interval_ms；重发内容由调用方注入 regenerate 回调）
 *
 * 降级策略：SMTP/钉钉未配置或发送失败时记录 failed 日志，不影响业务；
 * 敏感信息（smtp.pass / webhook 完整地址）不落日志、不返回给前端（webhook 脱敏）。
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const nodemailer = require('nodemailer');
const { snowflakeId } = require('../utils/snowflake');

function nowISO() { return new Date().toISOString(); }

function dingtalkSign(secret, t) {
  const stringToSign = `${t}\n${secret}`;
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  const data = hmac.update(Buffer.from(stringToSign, 'utf8')).digest('base64');
  return encodeURIComponent(data);
}

function httpPostJson(url, body, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'POST',
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': data.length },
      timeout,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function smtpTransport(notify) {
  const smtp = (notify && notify.smtp) || {};
  if (smtp.transport === 'json') return nodemailer.createTransport({ jsonTransport: true });
  if (!smtp.enabled || !smtp.host) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port) || 465,
    secure: smtp.secure !== false,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass || '' } : undefined,
  });
}

function smtpReady(notify) {
  const smtp = (notify && notify.smtp) || {};
  return !!(smtp.transport === 'json' || (smtp.enabled && smtp.host));
}

/** 发送邮件。返回 {ok, error}（不抛出，供调用方降级）。 */
async function sendEmail(notify, { to, subject, html }) {
  try {
    if (!smtpReady(notify)) return { ok: false, error: 'smtp_not_configured' };
    const transporter = smtpTransport(notify);
    if (!transporter) return { ok: false, error: 'smtp_not_configured' };
    const smtp = (notify && notify.smtp) || {};
    const from = smtp.from || 'LocalMiniDrama 报表 <noreply@example.com>';
    const info = await transporter.sendMail({ from, to, subject, html });
    return { ok: true, messageId: info.messageId || '' };
  } catch (err) {
    return { ok: false, error: String(err.message || '').slice(0, 500) };
  }
}

/** 发送钉钉机器人消息。返回 {ok, error}。 */
async function sendDingtalk(notify, { webhook, title, markdown }) {
  try {
    if (!webhook) return { ok: false, error: 'dingtalk_webhook_missing' };
    let url = String(webhook);
    const secret = (notify && notify.dingtalk && notify.dingtalk.secret) || '';
    if (secret) {
      const t = Date.now();
      const sign = dingtalkSign(secret, t);
      url = `${url}${url.includes('?') ? '&' : '?'}timestamp=${t}&sign=${sign}`;
    }
    const r = await httpPostJson(url, {
      msgtype: 'markdown',
      markdown: { title: String(title || '数据报表').slice(0, 64), text: markdown },
    });
    let ok = r.status >= 200 && r.status < 300;
    try {
      const j = JSON.parse(r.body);
      if (j.errcode !== undefined && Number(j.errcode) !== 0) ok = false;
    } catch (_) { /* 非 JSON 按 HTTP 状态判断 */ }
    return ok
      ? { ok: true }
      : { ok: false, error: `http_${r.status} ${String(r.body || '').slice(0, 300)}` };
  } catch (err) {
    return { ok: false, error: String(err.message || '').slice(0, 500) };
  }
}

function writeLog(db, entry) {
  db.prepare(
    `INSERT INTO report_send_log
       (id, subscription_id, report_type, title, channel, recipient, status, error, retry_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    snowflakeId(),
    entry.subscription_id != null ? Number(entry.subscription_id) : null,
    entry.report_type || 'daily',
    String(entry.title || '').slice(0, 256),
    entry.channel,
    entry.recipient ? String(entry.recipient).slice(0, 256) : null,
    entry.status || 'failed',
    entry.error ? String(entry.error).slice(0, 512) : null,
    Number(entry.retry_count) || 0,
    nowISO(), nowISO()
  );
}

function maskWebhook(u) {
  const s = String(u || '');
  if (!s) return '';
  return s.length <= 16 ? '*'.repeat(s.length) : `${s.slice(0, 10)}...${s.slice(-6)}`;
}

/**
 * 按订阅分发：遍历 recipients，逐渠道发送并记录 report_send_log。
 * @returns {{results: Array<{channel,target,ok,error}>}}
 */
async function dispatch(db, log, notify, { subscription, report, title }) {
  const recipients = Array.isArray(subscription.recipients) ? subscription.recipients : [];
  if (!recipients.length) return { results: [] };
  const results = [];
  for (const r of recipients) {
    const channel = String(r.type || 'email');
    if (channel === 'email') {
      const target = String(r.target || '').trim();
      if (!target) continue;
      const out = await sendEmail(notify, { to: target, subject: title, html: report.html });
      writeLog(db, {
        subscription_id: subscription.id,
        report_type: subscription.report_type,
        title,
        channel: 'email',
        recipient: target,
        status: out.ok ? 'success' : 'failed',
        error: out.ok ? null : out.error,
      });
      results.push({ channel, target, ok: out.ok, error: out.error });
    } else if (channel === 'dingtalk') {
      const target = String(r.target || (notify.dingtalk && notify.dingtalk.webhook) || '').trim();
      if (!target) continue;
      const out = await sendDingtalk(notify, { webhook: target, title, markdown: report.markdown });
      writeLog(db, {
        subscription_id: subscription.id,
        report_type: subscription.report_type,
        title,
        channel: 'dingtalk',
        recipient: maskWebhook(target),
        status: out.ok ? 'success' : 'failed',
        error: out.ok ? null : out.error,
      });
      results.push({ channel, target: maskWebhook(target), ok: out.ok, error: out.error });
    }
  }
  return { results };
}

function listSendLogs(db, { subscription_id = null, status = null, channel = null, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const where = [];
  const params = [];
  if (subscription_id) { where.push('subscription_id = ?'); params.push(Number(subscription_id)); }
  if (status) { where.push('status = ?'); params.push(String(status)); }
  if (channel) { where.push('channel = ?'); params.push(String(channel)); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const totalRow = db.prepare(`SELECT COUNT(*) c FROM report_send_log ${whereSql}`).get(...params) || {};
  const rows = db.prepare(`SELECT * FROM report_send_log ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize) || [];
  return {
    total: Number(totalRow.c) || 0,
    page,
    pageSize,
    items: rows.map((r) => ({
      id: r.id,
      subscription_id: r.subscription_id,
      report_type: r.report_type,
      title: r.title,
      channel: r.channel,
      recipient: r.recipient,
      status: r.status,
      error: r.error,
      retry_count: r.retry_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  };
}

/**
 * 重试失败发送记录。
 * @param {object} opts { limit, id, regenerate }
 *   - id：指定重试某条记录（单条重试）；缺省则批量重试到期失败记录
 *   - regenerate 由调用方注入：(subscription) => { title, html, markdown }，用于重新生成报表内容
 */
async function retryFailed(db, log, notify, { limit = 10, id = null, regenerate = null } = {}) {
  const maxAttempts = Math.max(1, Number((notify && notify.retry && notify.retry.max_attempts) || 3));
  const intervalMs = Math.max(1000, Number((notify && notify.retry && notify.retry.interval_ms) || 300000));
  const since = new Date(Date.now() - intervalMs).toISOString();
  let rows;
  if (id != null) {
    rows = db.prepare(
      `SELECT * FROM report_send_log WHERE id = ? AND status = 'failed' AND retry_count < ?`
    ).all(Number(id), maxAttempts);
  } else {
    rows = db.prepare(
      `SELECT * FROM report_send_log
        WHERE status = 'failed' AND retry_count < ?
          AND updated_at <= ?
        ORDER BY id ASC LIMIT ?`
    ).all(maxAttempts, since, limit);
  }
  const retried = [];
  for (const row of rows) {
    let out = { ok: false, error: 'regenerate_unavailable' };
    const sub = row.subscription_id
      ? db.prepare('SELECT * FROM report_subscription WHERE id = ?').get(Number(row.subscription_id))
      : null;
    const recipients = sub ? (() => { try { return JSON.parse(sub.recipients); } catch { return []; } })() : null;
    if (sub && recipients && typeof regenerate === 'function') {
      const fmt = regenerate(sub);
      const recv = recipients.filter((x) => x && x.type === row.channel);
      if (recv.length) {
        if (row.channel === 'email') {
          out = await sendEmail(notify, { to: recv[0].target, subject: fmt.title, html: fmt.html });
        } else {
          out = await sendDingtalk(notify, {
            webhook: recv[0].target || (notify.dingtalk && notify.dingtalk.webhook) || '',
            title: fmt.title,
            markdown: fmt.markdown,
          });
        }
      } else {
        out = { ok: false, error: 'recipient_missing' };
      }
    }
    const rc = Number(row.retry_count) + 1;
    db.prepare('UPDATE report_send_log SET status = ?, error = ?, retry_count = ?, updated_at = ? WHERE id = ?').run(
      out.ok ? 'success' : 'failed',
      out.ok ? null : String(out.error || '').slice(0, 512),
      rc,
      nowISO(),
      Number(row.id)
    );
    retried.push({ id: row.id, retry_count: rc, ok: out.ok, error: out.error });
  }
  return { checked: rows.length, retried };
}

module.exports = {
  sendEmail,
  sendDingtalk,
  dispatch,
  retryFailed,
  listSendLogs,
};
