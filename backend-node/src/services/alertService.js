/**
 * 数据异常告警通知服务：
 *   - 通道：钉钉机器人（dingtalk） / 企业微信机器人（wecom） / 飞书机器人（feishu）
 *   - 节流：按 (channel_id, severity, anomaly_type, dedup_key) 指纹 + 每个渠道 rate_limit_minutes 最小间隔
 *   - 使用：
 *       // 自动定时（由 src/routes/admin.js 的 GET /scan 或单独 cron job 调）
 *       await alertService.scanAndAlert({ db, log, overrides });
 *
 *       // 手动对某条已发现异常发一次（调试用）
 *       await alertService.dispatchItem({ db, log }, item, { webhookOverride: 'https://...' });
 */
const crypto = require('crypto');
const http   = require('http');
const https  = require('https');

const SEVERITY_BIT = { critical: 1, warning: 2, info: 4 };

function nowISO() { return new Date().toISOString(); }
function jsonParseSafe(s, d) { try { return JSON.parse(s) ?? d; } catch { return d; } }

// ========== 通用：sync-mysql 对 `""` 占位符会当作 NULL（兼容性坑）==========
// 这里统一做一层 `?` 参数包装：空字符串 → `NULL IF(TRIM(?), '')` 不对，我们反着来：
// 把空字符串当作 `" \u0000"` (空格+NUL) 写入，再在列定义 / 业务逻辑上认为空字符串等于这个值。
// 更干净的方案：placeholder 传空值时，改用 NULL，再用 COALESCE(?, '')（但我们又没法在 SQL 改每一个占位符）。
// 所以最后选择：在 db.prepare().run 前对所有字符串参数做空值替换（空字符串 → " "），读取时再 trim。
function safeBind(db) {
  return function bind(sql, values) {
    const safeVals = values.map((v) => {
      if (v === '' && db.type === 'mysql') return ' '; // 规避 sync-mysql 空串→NULL 的坑；读出来时会 trim（或由前端 mask 展示）
      return v;
    });
    return db.prepare(sql).run(...safeVals);
  };
}
function safeBindForSelect(db) {
  return function bind(sql, values) {
    const safeVals = values.map((v) => {
      if (v === '' && db.type === 'mysql') return ' ';
      return v;
    });
    const stmt = db.prepare(sql);
    return stmt;
  };
}
// ========== 1. 列兼容工具（避免调用方没跑 migration 时炸）==========
function hasColumn(db, table, col) {
  const rows = (db.type === 'mysql')
    ? db.prepare('SHOW COLUMNS FROM ' + table).all().map((r) => r.Field)
    : db.prepare('PRAGMA table_info(' + table + ')').all().map((r) => r.name);
  return rows.some((x) => String(x).toLowerCase() === String(col).toLowerCase());
}
function ensureTablesExist(db) {
  return hasColumn(db, 'anomaly_alert_channels', 'webhook_url')
      && hasColumn(db, 'anomaly_alert_events',  'fingerprint');
}

// ========== 2. 钉钉加签 ==========
function dingtalkSign(secret, t) {
  const stringToSign = `${t}\n${secret}`;
  const hmac = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'));
  const data = hmac.update(Buffer.from(stringToSign, 'utf8')).digest('base64');
  return encodeURIComponent(data);
}

// ========== 3. 三家机器人消息体构造 ==========
function buildPayloads(channel, summary, detailLines, mentionMobiles, mentionAll) {
  const md = `## 🚨 数据异常告警\n- **级别**：${String(channel.__severity || 'info').toUpperCase()}\n- **类型**：${channel.__type || '-'}\n- **摘要**：${summary}\n- **时间**：${nowISO()}\n\n${detailLines.length ? detailLines.map(l => '  • ' + l).join('\n') : ''}`;
  const text =
    `【数据异常告警】\n级别：${channel.__severity || 'info'}\n类型：${channel.__type || '-'}\n摘要：${summary}\n时间：${nowISO()}`
    + (detailLines.length ? '\n明细：\n' + detailLines.map(l => '  - ' + l).join('\n') : '');

  const dingtalk = {
    msgtype: 'markdown',
    markdown: { title: '数据异常告警', text: md +
      (mentionMobiles?.length ? '\n\n@' + mentionMobiles.join(' @') : '') },
    at: {
      atMobiles: mentionMobiles || [],
      isAtAll: !!mentionAll
    }
  };
  // 企业微信群机器人：markdown or text
  const wecom = {
    msgtype: 'markdown',
    markdown: {
      content:
        (mentionMobiles?.length ? mentionMobiles.map(m => `<@${m}>`).join('') + '\n' : '')
        + (mentionAll ? '<@all>\n' : '')
        + md
    }
  };
  // 飞书富文本（interactive 太重，直接 text 简单可靠）
  const feishu = {
    msg_type: 'text',
    content: {
      text:
        (mentionAll ? '<at user_id="all">所有人</at>\n' : '')
        + (mentionMobiles?.length ? mentionMobiles.map(m => `<at phone="${m}">${m}</at>`).join(' ') + '\n' : '')
        + text
    }
  };
  return { dingtalk, wecom, feishu };
}

// ========== 4. 通用 HTTPS/HTTP POST（避免引入 axios）==========
function httpPostJson(url, body, timeout = 6000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = Buffer.from(JSON.stringify(body));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: 'POST', hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': data.length
      },
      timeout
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ========== 5. 核心：发一次 webhook + 写 events 表（事务 + 节流）==========
async function dispatchToChannel({ db, log }, channel, item) {
  const detailLines = [];
  if (item.row) {
    for (const k of ['id','user_id','phone','nickname','amount','balance_after','created_at']) {
      if (item.row[k] !== undefined && item.row[k] !== null && item.row[k] !== '') {
        detailLines.push(`${k}=${item.row[k]}`);
      }
    }
  }
  if (item.reason) detailLines.push(`reason=${item.reason}`);

  // 订阅检查
  const sevBit = SEVERITY_BIT[item.severity] ?? 0;
  if (!sevBit || (Number(channel.severity_mask) & sevBit) === 0) {
    return { skipped: true, reason: 'severity_mismatch' };
  }
  const types = String(channel.type_mask || '*').trim();
  if (types !== '*') {
    const set = new Set(types.split(/[,，\s]+/).filter(Boolean));
    if (!set.has(item.type)) return { skipped: true, reason: 'type_mask' };
  }

  // 节流：按 (channel_id, severity, anomaly_type) + 可选 item.row?.user_id / id 作为 dedup_key
  const dedupKey = [
    item.severity, item.type,
    (item.row && (item.row.user_id || item.row.id)) || item.id || 'x'
  ].join('::');
  const fp = crypto.createHash('md5').update(`${channel.id}::${dedupKey}`).digest('hex');
  const intervalMin = Math.max(0, Number(channel.rate_limit_minutes) || 0);

  const mentionMobiles = Array.isArray(channel.__mentionMobiles)
    ? channel.__mentionMobiles
    : jsonParseSafe(channel.mention_mobiles, []);
  const mentionAll = !!Number(channel.mention_all || 0);

  // 用事务：events 插入节流检查 + 发送成功回填 sent_at
  let transaction;
  if (db.type === 'sqlite' && typeof db.transaction === 'function') {
    transaction = (fn) => {
      const txn = db.transaction(fn);
      return typeof txn.immediate === 'function' ? txn.immediate() : txn();
    };
  } else {
    transaction = (fn) => db.transaction(fn)();
  }

  return transaction(async () => {
    const bind = safeBind(db);
    if (intervalMin > 0) {
      const recent = db.prepare(
        `SELECT id, status FROM anomaly_alert_events
         WHERE channel_id = ? AND fingerprint = ?
           AND created_at >= datetime('now', ?)
         ORDER BY id DESC LIMIT 1`
      ).get(channel.id, fp, `-${intervalMin} minutes`);
      if (recent && recent.status === 'sent') {
        bind(
          `INSERT INTO anomaly_alert_events (channel_id,fingerprint,anomaly_type,severity,summary,status,created_at)
           VALUES (?,?,?,?,?,'suppressed',?)`,
          [channel.id, fp, item.type || '', item.severity || 'info',
           item.reason ? item.reason.slice(0, 500) : '', nowISO()]
        );
        return { skipped: true, reason: 'rate_limit', fp };
      }
    }

    // 写 pending
    const payloadJson = JSON.stringify(item);
    const summary500 = (item.reason || '数据异常').slice(0, 500);
    const run = bind(
      `INSERT INTO anomaly_alert_events (channel_id,fingerprint,anomaly_type,severity,summary,payload,status,created_at)
       VALUES (?,?,?,?,?,?, 'pending', ?)`,
      [channel.id, fp, item.type || '', item.severity || 'info', summary500, payloadJson, nowISO()]
    );
    const evId = Number(run.lastInsertRowid || run.insertId || 0);

    // 补签（钉钉/飞书需要 secret，企业微信则不需要）
    let url = channel.webhook_url;
    try {
      if (channel.channel_type === 'dingtalk' && channel.secret) {
        const t = Date.now();
        const sign = dingtalkSign(channel.secret, t);
        const sep = url.includes('?') ? '&' : '?';
        url = `${url}${sep}timestamp=${t}&sign=${sign}`;
      }
      const fake = { __severity: item.severity, __type: item.type };
      const payloads = buildPayloads(
        Object.assign({}, channel, fake),
        summary500,
        detailLines.slice(0, 20),
        mentionMobiles,
        mentionAll
      );
      const body = payloads[String(channel.channel_type)];
      if (!body) throw new Error('unknown channel_type: ' + channel.channel_type);
      const r = await httpPostJson(url, body);
      const ok = r.status >= 200 && r.status < 300;
      let downstreamOK = ok;
      try {
        const j = JSON.parse(r.body);
        if (j.errcode !== undefined && Number(j.errcode) !== 0) downstreamOK = false;
        if (j.code !== undefined && Number(j.code) !== 0) downstreamOK = false;
      } catch {}
      const status = downstreamOK ? 'sent' : 'failed';
      const err = downstreamOK ? '' : ('status=' + r.status + ' body=' + String(r.body||'').slice(0,500));
      bind(
        `UPDATE anomaly_alert_events SET status=?, error_msg=?, sent_at=? WHERE id=?`,
        [status, err, downstreamOK ? nowISO() : null, evId]
      );
      if (!downstreamOK) throw new Error(err || 'send failed');
      return { ok: true, event_id: evId, fp };
    } catch (e) {
      // 状态置 failed，但不 throw（保证其它渠道还能继续发）
      try {
        bind(
          `UPDATE anomaly_alert_events SET status='failed', error_msg=? WHERE id=?`,
          [String(e.message || '').slice(0, 1000), evId]
        );
      } catch {}
      return { ok: false, event_id: evId, error: e.message, fp };
    }
  });
}

// ========== 6. 对外：手动 dispatch 一条 item（/api/v1/admin/data-anomalies/alert/:id 会用）==========
async function dispatchItem(ctx, item, opts = {}) {
  const { db } = ctx;
  if (!ensureTablesExist(db)) throw new Error('anomaly_alert_channels / events 表不存在，请先跑 migration 30');
  const webhookOverride = opts.webhookOverride;
  const channels = webhookOverride
    ? [{
        id: 0, name: 'adhoc', channel_type: opts.channelType || guessChannel(webhookOverride),
        webhook_url: webhookOverride, secret: opts.secret || '',
        mention_all: opts.mentionAll ? 1 : 0,
        mention_mobiles: JSON.stringify(opts.mentionMobiles || []),
        severity_mask: 7, type_mask: '*', rate_limit_minutes: 0
      }]
    : db.prepare('SELECT * FROM anomaly_alert_channels WHERE enabled=1 ORDER BY id ASC').all();
  const results = [];
  for (const c of channels) {
    c.__mentionMobiles = jsonParseSafe(c.mention_mobiles, []) || [];
    // eslint-disable-next-line no-await-in-loop
    results.push(await dispatchToChannel(ctx, c, item));
  }
  return results;
}

function guessChannel(url) {
  const s = String(url || '').toLowerCase();
  if (s.includes('qyapi.weixin') || s.includes('weixin')) return 'wecom';
  if (s.includes('feishu.cn') || s.includes('larksuite.com')) return 'feishu';
  return 'dingtalk';
}

// ========== 7. 对外：扫描一次 + 自动告警（给定时任务）==========
async function scanAndAlert({ db, log, overrides }) {
  if (!ensureTablesExist(db)) {
    if (log?.warn) log.warn('alertService.scanAndAlert', { reason: 'tables_missing' });
    return { ok: false, error: 'tables_missing' };
  }
  // 动态 import routes/admin 里的 getDataAnomalies 太重，我们直接复用"快速 critical/warning 版"扫描 SQL
  // （避免依赖 Express req/res）。这一套 SQL 跟 admin.js 保持一致，列缺失自动跳过。
  const amountTh  = Number(overrides?.amount_threshold  || process.env.ANOMALY_DEFAULT_AMOUNT_TH  || 2e8) || 2e8;
  const balanceTh = Number(overrides?.balance_threshold || process.env.ANOMALY_DEFAULT_BALANCE_TH || 5e8) || 5e8;
  const limit     = Math.min(500, Number(overrides?.limit || 30));

  const colPl = new Set(
    ((db.type === 'mysql')
      ? db.prepare('SHOW COLUMNS FROM point_logs').all()
      : db.prepare('PRAGMA table_info(point_logs)').all()
    ).map((r) => (r.Field !== undefined ? r.Field : r.name).toLowerCase())
  );
  const colUs = new Set(
    ((db.type === 'mysql')
      ? db.prepare('SHOW COLUMNS FROM users').all()
      : db.prepare('PRAGMA table_info(users)').all()
    ).map((r) => (r.Field !== undefined ? r.Field : r.name).toLowerCase())
  );

  const items = [];
  function _cols(table, wanted) {
    const existing = (db.type === 'mysql')
      ? db.prepare('SHOW COLUMNS FROM ' + table).all().map(r => r.Field)
      : db.prepare('PRAGMA table_info(' + table + ')').all().map(r => r.name);
    const s = new Set(existing.map(x => String(x).toLowerCase()));
    return wanted.filter(x => s.has(String(x).toLowerCase()));
  }
  if (colPl.has('balance_after')) {
    const cols = _cols('point_logs', ['id','user_id','amount','balance_after','reason','created_at']);
    const negPl = db.prepare(
      `SELECT ${cols.join(',')} FROM point_logs WHERE balance_after < 0 ORDER BY id DESC LIMIT ${limit}`
    ).all();
    for (const r of negPl) items.push({
      id: 'neg_bal_' + r.id,
      type: 'negative_balance',
      severity: 'critical',
      reason: `point_logs#${r.id} balance_after=${r.balance_after}（为负）`,
      row: Object.assign({}, r)
    });
  }
  if (colUs.has('balance')) {
    const cols = _cols('users', ['id','balance','nickname','phone']);
    const negU = db.prepare(`SELECT ${cols.join(',')} FROM users WHERE balance < 0 LIMIT ${limit}`).all();
    for (const r of negU) items.push({
      id: 'userbalneg_' + r.id,
      type: 'negative_user_balance',
      severity: 'critical',
      reason: `用户#${r.id} balance=${r.balance}（为负）`,
      row: Object.assign({}, r)
    });
  }
  if (colPl.has('amount') && colPl.has('balance_after')) {
    const cols = _cols('point_logs', ['id','user_id','amount','balance_after','reason','created_at']);
    const big = db.prepare(
      `SELECT ${cols.join(',')} FROM point_logs WHERE ABS(amount) >= ? ORDER BY ABS(amount) DESC LIMIT ${limit}`
    ).all(amountTh);
    for (const r of big) items.push({
      id: 'bigamt_' + r.id,
      type: 'huge_amount',
      severity: 'warning',
      reason: `单笔积分 |amount|=${r.amount} ≥ ${amountTh}`,
      row: Object.assign({}, r)
    });
  }
  if (colUs.has('balance') && colPl.has('balance_after')) {
    // users.balance vs 最近 point_logs.balance_after
    const uCols = _cols('users', ['id','balance','nickname','phone']).map(c => 'u.'+c);
    const mismatch = db.prepare(
      `SELECT ${uCols.join(',')}, pl.balance_after AS log_balance, pl.id AS log_id
       FROM users u
       JOIN point_logs pl ON pl.id = (SELECT id FROM point_logs WHERE user_id=u.id ORDER BY id DESC LIMIT 1)
       WHERE (u.balance <> pl.balance_after) AND (ABS(u.balance - pl.balance_after) >= ?)
       LIMIT ${limit}`
    ).all(Math.min(balanceTh, 100));
    for (const r of mismatch) items.push({
      id: 'mismatch_' + r.id,
      type: 'balance_mismatch',
      severity: 'critical',
      reason: `用户#${r.id} balance=${r.balance} 但最近日志#${r.log_id} balance_after=${r.log_balance}`,
      row: Object.assign({}, r)
    });
  }

  // 实际发通知（按严重级别先 critical 再 warning）
  items.sort((a, b) => (SEVERITY_BIT[b.severity] || 0) - (SEVERITY_BIT[a.severity] || 0));
  const channels = db.prepare('SELECT * FROM anomaly_alert_channels WHERE enabled=1 ORDER BY id ASC').all();
  const dispatched = [];
  for (const c of channels) {
    c.__mentionMobiles = jsonParseSafe(c.mention_mobiles, []) || [];
  }
  for (const it of items.slice(0, Math.min(items.length, Math.max(3, Number(overrides?.maxItems || 15))))) {
    for (const c of channels) {
      // eslint-disable-next-line no-await-in-loop
      dispatched.push(await dispatchToChannel({ db, log }, c, it));
    }
  }
  return { scanned: items.length, dispatched: dispatched.length, items, results: dispatched };
}

// ========== 8. 管理端：channels CRUD ==========
function listChannels(db) {
  if (!ensureTablesExist(db)) return [];
  return db.prepare('SELECT * FROM anomaly_alert_channels ORDER BY id DESC').all().map((c) => {
    c.mention_mobiles = jsonParseSafe(c.mention_mobiles, []);
    // sync-mysql 空值坑：读回来 trim 掉尾部单空格
    for (const k of ['name','channel_type','webhook_url','secret','type_mask','remark']) {
      if (typeof c[k] === 'string') c[k] = c[k].replace(/[ \t]+$/g, '');
    }
    c.webhook_url_masked = maskUrl(c.webhook_url);
    return c;
  });
}
function maskUrl(u) {
  try {
    if (!u) return '';
    const s = String(u);
    if (s.length <= 16) return '*'.repeat(s.length);
    return s.slice(0, 10) + '...' + s.slice(-6);
  } catch { return u; }
}
function createChannel(db, body) {
  if (!ensureTablesExist(db)) throw new Error('tables_missing');
  const channel_type = String(body.channel_type || 'dingtalk').toLowerCase();
  if (!['dingtalk','wecom','feishu'].includes(channel_type)) throw new Error('channel_type 非法');
  if (!body.webhook_url) throw new Error('webhook_url 必填');
  const mention_mobiles = JSON.stringify(Array.isArray(body.mention_mobiles) ? body.mention_mobiles.filter(Boolean) : []);
  const cols = (db.type === 'mysql')
    ? db.prepare('SHOW COLUMNS FROM anomaly_alert_channels').all().map((r) => r.Field)
    : db.prepare('PRAGMA table_info(anomaly_alert_channels)').all().map((r) => r.name);
  const colSet = new Set(cols.map((x) => x.toLowerCase()));
  const rows = [
    ['name',              String(body.name || '未命名').slice(0, 100)],
    ['channel_type',      channel_type],
    ['webhook_url',       String(body.webhook_url)],
    ['secret',            String(body.secret || '')],
    ['mention_mobiles',   mention_mobiles],
    ['mention_all',       body.mention_all ? 1 : 0],
    ['severity_mask',     Number(body.severity_mask) & 7 || 7],
    ['type_mask',         body.type_mask == null ? '*' : String(body.type_mask)],
    ['rate_limit_minutes',Math.max(0, Number(body.rate_limit_minutes) || 0)],
    ['enabled',           body.enabled === false ? 0 : 1],
    ['remark',            String(body.remark || '').slice(0, 500)]
  ].filter(([k]) => colSet.has(k.toLowerCase()));
  const keys = rows.map(([k]) => k);
  const placeholders = keys.map(() => '?');
  const values = rows.map(([,v]) => v);
  if (colSet.has('created_at')) { keys.push('created_at'); placeholders.push('?'); values.push(nowISO()); }
  if (colSet.has('updated_at')) { keys.push('updated_at'); placeholders.push('?'); values.push(nowISO()); }
  const placeholderStr = placeholders.join(',');
  const bind = safeBind(db);
  const r = bind(
    `INSERT INTO anomaly_alert_channels (${keys.join(',')}) VALUES (${placeholderStr})`,
    values
  );
  return Number(r.lastInsertRowid || r.insertId || 0);
}
function updateChannel(db, id, body) {
  if (!ensureTablesExist(db)) throw new Error('tables_missing');
  const exists = db.prepare('SELECT id FROM anomaly_alert_channels WHERE id=?').get(Number(id));
  if (!exists) throw new Error('渠道不存在');
  const patch = {};
  if (body.name !== undefined) patch.name = String(body.name).slice(0,100);
  if (body.channel_type !== undefined) {
    const ct = String(body.channel_type).toLowerCase();
    if (['dingtalk','wecom','feishu'].includes(ct)) patch.channel_type = ct;
  }
  if (body.webhook_url) patch.webhook_url = String(body.webhook_url);
  if (body.secret !== undefined) patch.secret = String(body.secret || '');
  if (body.mention_mobiles !== undefined) patch.mention_mobiles = JSON.stringify(Array.isArray(body.mention_mobiles) ? body.mention_mobiles.filter(Boolean) : []);
  if (body.mention_all !== undefined) patch.mention_all = body.mention_all ? 1 : 0;
  if (body.severity_mask !== undefined) patch.severity_mask = Number(body.severity_mask) & 7 || 7;
  if (body.type_mask !== undefined) patch.type_mask = String(body.type_mask);
  if (body.rate_limit_minutes !== undefined) patch.rate_limit_minutes = Math.max(0, Number(body.rate_limit_minutes) || 0);
  if (body.enabled !== undefined) patch.enabled = body.enabled === false ? 0 : 1;
  if (body.remark !== undefined) patch.remark = String(body.remark || '').slice(0, 500);
  patch.updated_at = nowISO();
  const pairs = Object.entries(patch).map(([k]) => `${k} = ?`);
  const vals  = [...Object.values(patch), Number(id)];
  safeBind(db)(`UPDATE anomaly_alert_channels SET ${pairs.join(',')} WHERE id = ?`, vals);
  return { id: Number(id) };
}
function deleteChannel(db, id) {
  if (!ensureTablesExist(db)) throw new Error('tables_missing');
  db.prepare('DELETE FROM anomaly_alert_channels WHERE id=?').run(Number(id));
  return { id: Number(id) };
}

// ========== 9. 管理端：events 查看（告警历史）==========
function listEvents(db, { limit = 100, channel_id, status, severity } = {}) {
  if (!ensureTablesExist(db)) return [];
  const where = [];
  const args = [];
  if (channel_id) { where.push('channel_id = ?'); args.push(Number(channel_id)); }
  if (status)     { where.push('status = ?');     args.push(String(status)); }
  if (severity)   { where.push('severity = ?');   args.push(String(severity)); }
  const sql = `SELECT * FROM anomaly_alert_events
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY id DESC LIMIT ${Math.min(500, Math.max(1, Number(limit) || 100))}`;
  return db.prepare(sql).all(...args).map((e) => {
    e.payload = jsonParseSafe(e.payload, null);
    return e;
  });
}

module.exports = {
  // 核心能力
  scanAndAlert,
  dispatchItem,
  dispatchToChannel,
  // 管理端 CRUD
  listChannels, createChannel, updateChannel, deleteChannel,
  listEvents
};
