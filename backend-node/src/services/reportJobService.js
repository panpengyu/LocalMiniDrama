'use strict';

/**
 * Sprint 18 - S18-T02 报表订阅与生成服务
 *
 *   - 报表模板 CRUD（report_templates：选择分析模块与参数）
 *   - 订阅 CRUD（report_subscription：周期/模板/接收渠道/开关）
 *   - generateReport()：按模板生成真实报表数据（复用 analyticsService）
 *   - formatReport()：报表数据 → { title, markdown, html }（钉钉/邮件正文）
 *   - runSubscription()：生成 + 分发 + 记录运行时间
 *   - runDueSubscriptions()：按 next_run_at 到期运行（手动/测试触发）
 *   - start()：node-cron 每日调度器（非致命降级，配置未启用则跳过）
 *
 * 报表数据全部来自真实 MySQL 聚合，无 mock；发送失败记录 report_send_log 可重试。
 */

const cron = require('node-cron');
const { snowflakeId } = require('../utils/snowflake');
const analyticsService = require('./analyticsService');
const notifyService = require('./notifyService');

const DAILY_CRON = '0 0 8 * * *'; // 每天 08:00 检查一次到期订阅

function nowISO() { return new Date().toISOString(); }
function jsonParseSafe(s, d) { try { return JSON.parse(s) ?? d; } catch { return d; } }
function fmtInt(n) { return Number(n || 0).toLocaleString('zh-CN'); }
function fmtPct(n) { return n == null ? '-' : `${n}%`; }

// ---------------- 报表模板 CRUD ----------------
function listTemplates(db) {
  return (db.prepare('SELECT * FROM report_templates ORDER BY id DESC').all() || []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    sections: jsonParseSafe(t.sections, []),
    params: jsonParseSafe(t.params, {}),
    created_at: t.created_at,
    updated_at: t.updated_at,
  }));
}

function getTemplate(db, id) {
  const t = db.prepare('SELECT * FROM report_templates WHERE id = ?').get(Number(id));
  if (!t) return null;
  t.sections = jsonParseSafe(t.sections, []);
  t.params = jsonParseSafe(t.params, {});
  return t;
}

function createTemplate(db, body) {
  const id = snowflakeId();
  db.prepare(
    `INSERT INTO report_templates (id, name, description, sections, params, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    String(body.name || '未命名模板').slice(0, 128),
    body.description ? String(body.description).slice(0, 512) : null,
    JSON.stringify(Array.isArray(body.sections) && body.sections.length ? body.sections : ['overview']),
    JSON.stringify(body.params || {}),
    nowISO(), nowISO()
  );
  return { id };
}

function updateTemplate(db, id, body) {
  const exists = db.prepare('SELECT id FROM report_templates WHERE id = ?').get(Number(id));
  if (!exists) throw new Error('模板不存在');
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).slice(0, 128);
  if (body.description !== undefined) patch.description = body.description ? String(body.description).slice(0, 512) : null;
  if (body.sections !== undefined) patch.sections = JSON.stringify(Array.isArray(body.sections) && body.sections.length ? body.sections : ['overview']);
  if (body.params !== undefined) patch.params = JSON.stringify(body.params || {});
  patch.updated_at = nowISO();
  const pairs = Object.entries(patch).map(([k]) => `${k} = ?`);
  db.prepare(`UPDATE report_templates SET ${pairs.join(',')} WHERE id = ?`).run(...Object.values(patch), Number(id));
  return { id: Number(id) };
}

function deleteTemplate(db, id) {
  db.prepare('DELETE FROM report_templates WHERE id = ?').run(Number(id));
  return { id: Number(id) };
}

// ---------------- 订阅 CRUD ----------------
function listSubscriptions(db) {
  return (db.prepare('SELECT * FROM report_subscription ORDER BY id DESC').all() || []).map((s) => ({
    id: s.id,
    name: s.name,
    report_type: s.report_type,
    template_id: s.template_id,
    schedule: s.schedule,
    recipients: jsonParseSafe(s.recipients, []),
    enabled: Number(s.enabled),
    last_run_at: s.last_run_at,
    next_run_at: s.next_run_at,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
}

function getSubscription(db, id) {
  const s = db.prepare('SELECT * FROM report_subscription WHERE id = ?').get(Number(id));
  if (!s) return null;
  s.recipients = jsonParseSafe(s.recipients, []);
  return s;
}

function sanitizeRecipients(rec) {
  return Array.isArray(rec)
    ? rec.filter((r) => r && r.target && ['email', 'dingtalk'].includes(String(r.type))).map((r) => ({ type: String(r.type), target: String(r.target).slice(0, 256) }))
    : [];
}

function createSubscription(db, body) {
  const id = snowflakeId();
  const reportType = ['daily', 'weekly', 'monthly'].includes(body.report_type) ? body.report_type : 'daily';
  db.prepare(
    `INSERT INTO report_subscription
       (id, name, report_type, template_id, schedule, recipients, enabled, last_run_at, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`
  ).run(
    id,
    String(body.name || '未命名订阅').slice(0, 128),
    reportType,
    body.template_id ? Number(body.template_id) : null,
    body.schedule ? String(body.schedule).slice(0, 64) : null,
    JSON.stringify(sanitizeRecipients(body.recipients)),
    body.enabled === false ? 0 : 1,
    nowISO(), nowISO()
  );
  return { id };
}

function updateSubscription(db, id, body) {
  const exists = db.prepare('SELECT id FROM report_subscription WHERE id = ?').get(Number(id));
  if (!exists) throw new Error('订阅不存在');
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).slice(0, 128);
  if (body.report_type !== undefined && ['daily', 'weekly', 'monthly'].includes(body.report_type)) patch.report_type = body.report_type;
  if (body.template_id !== undefined) patch.template_id = body.template_id ? Number(body.template_id) : null;
  if (body.schedule !== undefined) patch.schedule = body.schedule ? String(body.schedule).slice(0, 64) : null;
  if (body.recipients !== undefined) patch.recipients = JSON.stringify(sanitizeRecipients(body.recipients));
  if (body.enabled !== undefined) patch.enabled = body.enabled === false ? 0 : 1;
  patch.updated_at = nowISO();
  const pairs = Object.entries(patch).map(([k]) => `${k} = ?`);
  db.prepare(`UPDATE report_subscription SET ${pairs.join(',')} WHERE id = ?`).run(...Object.values(patch), Number(id));
  return { id: Number(id) };
}

function deleteSubscription(db, id) {
  db.prepare('DELETE FROM report_subscription WHERE id = ?').run(Number(id));
  return { id: Number(id) };
}

// ---------------- 报表生成 ----------------
const SECTION_HANDLERS = {
  overview: (db, days) => analyticsService.overview(db, { days }),
  behavior: (db, days) => analyticsService.behaviorAnalysis(db, { days }),
  funnel: (db) => analyticsService.creationFunnel(db),
  retention: (db, days) => analyticsService.retentionAnalysis(db, { cohortDays: Math.min(Number(days) || 14, 14) }),
  events: (db, days, params) => analyticsService.eventOverview(db, {
    steps: (params.funnel_steps || ['page_view', 'login']).map((e) => ({ event: e, label: e })),
    days,
  }),
  model: (db, days) => analyticsService.modelEffect(db, { days }),
};

function generateReport(db, { templateId = null, reportType = 'daily', days = null } = {}) {
  const template = templateId ? getTemplate(db, templateId) : null;
  const sections = template ? template.sections : ['overview', 'behavior', 'funnel', 'retention', 'events'];
  const params = template ? template.params : {};
  const d = days || Number(params.days) || (reportType === 'weekly' ? 7 : reportType === 'monthly' ? 30 : 1);
  const data = {};
  for (const sec of sections) {
    const fn = SECTION_HANDLERS[sec];
    if (!fn) continue;
    try {
      data[sec] = fn(db, d, params);
    } catch (err) {
      data[sec] = { error: String(err.message || '').slice(0, 200) };
    }
  }
  return { report_type: reportType, days: d, template_id: templateId, sections, data };
}

// ---------------- 报表格式化（markdown / html） ----------------
function formatReport(report) {
  const d = report.data || {};
  const title = `LocalMiniDrama 数据报表（${report.report_type} · 近${report.days}天）`;
  const md = [`## 📊 ${title}`, ''];

  const rows = []; // html 表格行
  const ov = d.overview || {};
  const bh = d.behavior || {};
  if (ov.behavior) {
    md.push('### 总体概览');
    md.push(`- 日活(DAU)：${fmtInt(ov.behavior.dau)} ｜ 周活(WAU)：${fmtInt(ov.behavior.wau)} ｜ 月活(MAU)：${fmtInt(ov.behavior.mau)}`);
    rows.push(['日活(DAU)', fmtInt(ov.behavior.dau)], ['周活(WAU)', fmtInt(ov.behavior.wau)], ['月活(MAU)', fmtInt(ov.behavior.mau)]);
    md.push('');
  }
  if (bh.total_actions != null) {
    md.push(`- 行为总量：${fmtInt(bh.total_actions)} ｜ 活跃用户：${fmtInt(bh.active_users)}`);
    md.push('');
  }

  const funnel = d.funnel || ov.funnel;
  if (funnel && Array.isArray(funnel.stages)) {
    md.push('### 创作转化漏斗');
    for (const s of funnel.stages) {
      md.push(`- ${s.label}：${fmtInt(s.count)}（${fmtPct(s.conversion_rate)}）`);
      rows.push([`漏斗·${s.label}`, `${fmtInt(s.count)}（${fmtPct(s.conversion_rate)}）`]);
    }
    md.push(`- **整体转化率**：${fmtPct(funnel.overall_rate)}`);
    md.push('');
  }

  const ret = d.retention;
  if (ret && Array.isArray(ret.cohorts) && ret.cohorts.length) {
    const last = ret.cohorts[ret.cohorts.length - 1];
    md.push('### 留存（最近分群）');
    md.push(`- 分群 ${last.cohort_date} 新增 ${fmtInt(last.new_users)}：次日留存 ${fmtPct(last.d1)} ｜ 7日留存 ${fmtPct(last.d7)} ｜ 30日留存 ${fmtPct(last.d30)}`);
    rows.push(['留存·次日', fmtPct(last.d1)], ['留存·7日', fmtPct(last.d7)], ['留存·30日', fmtPct(last.d30)]);
    md.push('');
  }

  const ev = d.events || {};
  if (ev.stats) {
    md.push('### 事件概览');
    md.push(`- 事件总量：${fmtInt(ev.stats.total_events)} ｜ 独立用户：${fmtInt(ev.stats.users)}`);
    rows.push(['事件总量', fmtInt(ev.stats.total_events)], ['事件独立用户', fmtInt(ev.stats.users)]);
    if (ev.funnel && ev.funnel.overall_rate != null) {
      md.push(`- 事件漏斗整体转化率：${fmtPct(ev.funnel.overall_rate)}`);
      rows.push(['事件漏斗转化率', fmtPct(ev.funnel.overall_rate)]);
    }
    md.push('');
  }

  const html = `<h3>${title}</h3>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<tr><th>指标</th><th>数值</th></tr>
${rows.map((r) => `<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}
</table>`;

  return { title, markdown: md.join('\n'), html };
}

function nextRunAt(sub) {
  const ms = sub.report_type === 'daily' ? 86400000 : sub.report_type === 'weekly' ? 604800000 : 2592000000;
  return new Date(Date.now() + ms).toISOString();
}

/** 生成 + 分发一条订阅，并记录 last_run_at / next_run_at。 */
async function runSubscription(db, log, notify, sub) {
  const report = generateReport(db, { templateId: sub.template_id, reportType: sub.report_type });
  const fmt = formatReport(report);
  const out = await notifyService.dispatch(db, log, notify, {
    subscription: sub,
    report: { html: fmt.html, markdown: fmt.markdown },
    title: fmt.title,
  });
  const now = nowISO();
  db.prepare('UPDATE report_subscription SET last_run_at = ?, next_run_at = ? WHERE id = ?').run(now, nextRunAt(sub), Number(sub.id));
  return { subscription_id: Number(sub.id), title: fmt.title, results: out.results };
}

/** 运行所有到期订阅（force=true 时全部运行）。 */
async function runDueSubscriptions(db, log, notify, { force = false } = {}) {
  const subs = listSubscriptions(db).filter((s) => Number(s.enabled) === 1);
  const results = [];
  for (const s of subs) {
    if (force || s.next_run_at == null || new Date(s.next_run_at) <= new Date()) {
      results.push(await runSubscription(db, log, notify, s));
    }
  }
  return results;
}

/** 启动 node-cron 调度器（每日 08:00 检查到期订阅；配置 cron.enabled=false 时跳过）。 */
function start(db, log, config) {
  const notify = (config && config.notify) || {};
  const cronCfg = notify.cron || {};
  if (cronCfg.enabled === false) {
    log.info('[S18-T02] 报表调度器未启用（cron.enabled=false）');
    return { started: false, reason: 'cron_disabled' };
  }
  const tz = cronCfg.timezone || 'Asia/Shanghai';
  if (!cron.validate(DAILY_CRON)) {
    log.warn('[S18-T02] 报表调度器表达式无效', { expr: DAILY_CRON });
    return { started: false, reason: 'invalid_cron' };
  }
  cron.schedule(DAILY_CRON, () => {
    try {
      runDueSubscriptions(db, log, notify, { force: false }).catch((e) => {
        log.error('[S18-T02] 定时报表执行失败', { error: e.message });
      });
    } catch (e) {
      log.error('[S18-T02] 定时报表执行失败', { error: e.message });
    }
  }, { timezone: tz });
  log.info('[S18-T02] 报表调度器已启动', { cron: DAILY_CRON, timezone: tz });
  return { started: true, cron: DAILY_CRON, timezone: tz };
}

module.exports = {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listSubscriptions,
  getSubscription,
  createSubscription,
  updateSubscription,
  deleteSubscription,
  generateReport,
  formatReport,
  runSubscription,
  runDueSubscriptions,
  start,
};
