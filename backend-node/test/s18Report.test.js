'use strict';

/**
 * Sprint 18 - S18-T02 报表订阅/通知/仪表盘/导出 集成测试
 *
 * 约束：连接本地真实 MySQL（configs/config.yaml），无 mock；
 * 数据真实落库 report_subscription / report_templates / report_send_log / dashboard_layout；
 * 独立 ID 区间（9000005xx）+ s18t2_ 名称前缀隔离，after 精确清理，与其它测试文件并行跑不冲突。
 *
 * 覆盖：
 *   [1] 模板 CRUD：create/list/get/update/delete
 *   [2] 订阅 CRUD：create（recipients 清洗）/update（停用）/list 关联模板
 *   [3] generateReport：默认 5 模块 + 自定义模板 sections 驱动
 *   [4] formatReport：markdown 表格 + html 输出
 *   [5] runSubscription：json transport 真实 nodemailer 发送 + send_log 落库（邮件成功/钉钉降级）
 *   [6] listSendLogs：分页 + 状态/渠道筛选
 *   [7] retryFailed：单条 id 重试 + 批量重试（含 regenerate 重新生成内容）
 *   [8] dashboardLayout：getLayout 默认布局 / saveLayout 版本递增 / resetLayout 恢复默认
 *   [9] exportService：toCSV（RFC4180 转义 + UTF-8 BOM）/ toXLSX（合法 zip 包，含中文）
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const reports = require(path.resolve(__dirname, '..', 'src', 'services', 'reportJobService.js'));
const notify = require(path.resolve(__dirname, '..', 'src', 'services', 'notifyService.js'));
const dash = require(path.resolve(__dirname, '..', 'src', 'services', 'dashboardLayoutService.js'));
const { toCSV, toXLSX } = require(path.resolve(__dirname, '..', 'src', 'services', 'exportService.js'));
const { snowflakeId } = require(path.resolve(__dirname, '..', 'src', 'utils', 'snowflake.js'));

let db;
const log = { info() {}, warn() {}, error() {} };
const TAG = String(Date.now()).slice(-6);
const ADMIN_ID = 900000501;
// json transport：真实 nodemailer（jsonTransport 模式），不真正联网
const NOTIFY = {
  smtp: { transport: 'json', from: 'LocalMiniDrama <noreply@example.com>' },
  dingtalk: { webhook: '', secret: '' },
  retry: { max_attempts: 3, interval_ms: 1000 },
};

function cleanup() {
  db.prepare('DELETE FROM report_send_log WHERE subscription_id IN (SELECT id FROM report_subscription WHERE name LIKE ?)').run('s18t2\\_%');
  db.prepare('DELETE FROM report_send_log WHERE title LIKE ?').run('s18t2\\_%');
  db.prepare('DELETE FROM report_send_log WHERE id = 900000509').run(); // 批量重试固定 ID
  db.prepare("DELETE FROM report_subscription WHERE name LIKE 's18t2\\_%'").run();
  db.prepare("DELETE FROM report_templates WHERE name LIKE 's18t2\\_%'").run();
  db.prepare('DELETE FROM dashboard_layout WHERE admin_id = ?').run(ADMIN_ID);
}

test.before(() => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', 'S18-T02 集成测试要求 MySQL');
  db = getDb(cfg.database);
  cleanup();
});

test.after(() => {
  cleanup();
  closeDb(db);
});

let tplId = null;
let subId = null;

test('S18-T02 [1] 报表模板 CRUD', () => {
  const created = reports.createTemplate(db, {
    name: `s18t2_tpl_${TAG}`,
    description: '测试模板-日报',
    sections: ['overview', 'behavior', 'funnel'],
    params: { days: 7 },
  });
  tplId = created.id;
  assert.ok(tplId, '应返回模板 ID');

  const got = reports.getTemplate(db, tplId);
  assert.ok(got);
  assert.equal(got.name, `s18t2_tpl_${TAG}`);
  assert.deepEqual(got.sections, ['overview', 'behavior', 'funnel']);
  assert.equal(got.params.days, 7);

  const list = reports.listTemplates(db);
  assert.ok(list.find((t) => t.id === tplId), '列表应包含新模板');

  reports.updateTemplate(db, tplId, { name: `s18t2_tpl_${TAG}_v2`, sections: ['overview', 'events'] });
  const got2 = reports.getTemplate(db, tplId);
  assert.equal(got2.name, `s18t2_tpl_${TAG}_v2`);
  assert.deepEqual(got2.sections, ['overview', 'events']);
});

test('S18-T02 [2] 报表订阅 CRUD（recipients 清洗 + 停用）', () => {
  const created = reports.createSubscription(db, {
    name: `s18t2_sub_${TAG}`,
    report_type: 'daily',
    template_id: tplId,
    recipients: [
      { type: 'email', target: 's18t2@example.com' },
      { type: 'dingtalk', target: '' }, // 空 target 应被清洗
      { type: 'sms', target: '13800000000' }, // 非法渠道应被清洗
    ],
  });
  subId = created.id;
  assert.ok(subId, '应返回订阅 ID');

  const got = reports.getSubscription(db, subId);
  assert.equal(got.recipients.length, 1, '非法/空接收人应被清洗');
  assert.equal(got.recipients[0].type, 'email');
  assert.equal(got.recipients[0].target, 's18t2@example.com');
  assert.equal(got.enabled, 1);

  const list = reports.listSubscriptions(db);
  const mine = list.find((s) => s.id === subId);
  assert.ok(mine, '订阅列表应包含新订阅');
  assert.equal(mine.template_id, tplId);

  reports.updateSubscription(db, subId, { enabled: false });
  assert.equal(reports.getSubscription(db, subId).enabled, 0, '停用生效');
});

test('S18-T02 [3] generateReport 默认与自定义模板驱动', () => {
  const def = reports.generateReport(db, { reportType: 'daily', days: 7 });
  assert.ok(def.report_type === 'daily');
  assert.ok(def.days === 7);
  assert.ok(def.data.overview, '应含 overview 概览');
  assert.ok(def.data.behavior, '应含 behavior 行为');
  assert.ok(def.data.funnel, '应含 funnel 漏斗');
  assert.ok(def.data.retention, '应含 retention 留存');
  assert.ok(def.data.events, '应含 events 事件');

  const custom = reports.generateReport(db, { templateId: tplId, reportType: 'weekly', days: 14 });
  assert.ok(custom.data.overview, '自定义模板含 overview');
  assert.ok(custom.data.events, '自定义模板含 events（[1] 中已更新为 overview+events）');
  assert.equal(custom.data.behavior, undefined, '自定义模板无 behavior 模块');
  assert.equal(custom.data.retention, undefined, '自定义模板无 retention 模块');
});

test('S18-T02 [4] formatReport markdown + html', () => {
  const report = reports.generateReport(db, { templateId: tplId, reportType: 'daily', days: 7 });
  const fmt = reports.formatReport(report);
  assert.ok(fmt.markdown.includes('LocalMiniDrama'), 'markdown 应含标题');
  assert.ok(fmt.markdown.includes('### '), 'markdown 应含分节标题');
  assert.ok(fmt.markdown.includes('近7天'), 'markdown 应含天数');
  assert.ok(fmt.html.includes('<table'), 'html 应含表格');
  assert.ok(fmt.title.includes('LocalMiniDrama'), '标题应含品牌');
});

test('S18-T02 [5] runSubscription 发送 + send_log 落库', async () => {
  // 将订阅接收人补上钉钉 webhook（未配置密钥），验证邮件成功 + 钉钉降级
  reports.updateSubscription(db, subId, {
    recipients: [
      { type: 'email', target: 's18t2@example.com' },
      { type: 'dingtalk', target: 'https://oapi.dingtalk.com/robot/send?access_token=s18t2_fake' },
    ],
  });
  const sub = reports.getSubscription(db, subId);
  const out = await reports.runSubscription(db, log, NOTIFY, sub);

  const emailRes = out.results.find((r) => r.channel === 'email');
  assert.ok(emailRes && emailRes.ok === true, 'json transport 邮件应发送成功');

  const ddtRes = out.results.find((r) => r.channel === 'dingtalk');
  assert.ok(ddtRes && ddtRes.ok === false, '无真实 webhook 时应降级为失败');

  const logs = notify.listSendLogs(db, { subscription_id: subId, pageSize: 50 });
  assert.ok(logs.total >= 2, '应至少 2 条发送日志（邮件 + 钉钉）');
  const emailLog = logs.items.find((l) => l.channel === 'email');
  assert.equal(emailLog.status, 'success');
  assert.ok(emailLog.title.includes('LocalMiniDrama'), '日志标题含品牌');
});

test('S18-T02 [6] listSendLogs 分页与筛选', () => {
  const all = notify.listSendLogs(db, { subscription_id: subId, pageSize: 50 });
  const successOnly = notify.listSendLogs(db, { subscription_id: subId, status: 'success', pageSize: 50 });
  assert.ok(all.total >= 2);
  assert.ok(successOnly.total >= 1);
  assert.ok(successOnly.items.every((l) => l.status === 'success'), '筛选仅返回成功项');

  const p1 = notify.listSendLogs(db, { subscription_id: subId, page: 1, pageSize: 1 });
  assert.equal(p1.items.length, 1, '分页大小生效');
  assert.ok(p1.total >= 2);
});

test('S18-T02 [7] retryFailed 单条与批量重试', async () => {
  // 造一条失败记录（无真实 SMTP：smtp 未配置）
  const sub = reports.getSubscription(db, subId);
  const badNotify = { smtp: { transport: 'json' }, dingtalk: { webhook: '' } };
  const out = await reports.runSubscription(db, log, badNotify, {
    ...sub,
    recipients: [{ type: 'email', target: 'retry@example.com' }],
  });
  assert.ok(out.results[0].ok === true, 'json transport 仍成功（不用于失败造数）');

  // 直接构造失败日志：不存在的渠道类型 → dispatch 跳过，改用手工写日志模拟
  const logs = notify.listSendLogs(db, { subscription_id: subId, status: 'failed', pageSize: 50 });
  let failedId = null;
  if (!logs.total) {
    // 用钉钉无 webhook 造失败
    const out2 = await reports.runSubscription(db, log, { smtp: {}, dingtalk: {} }, {
      ...sub,
      recipients: [{ type: 'dingtalk', target: 'https://oapi.dingtalk.com/robot/send?access_token=none' }],
    });
    assert.equal(out2.results[0].ok, false, '无 webhook 应发送失败');
    const l2 = notify.listSendLogs(db, { subscription_id: subId, status: 'failed', pageSize: 50 });
    failedId = l2.items[0].id;
  } else {
    failedId = logs.items[0].id;
  }
  assert.ok(failedId, '应有失败日志');

  // 单条重试（regenerate 重新生成报表内容）
  const one = await notify.retryFailed(db, log, NOTIFY, {
    id: failedId,
    regenerate: (s) => {
      const r = reports.generateReport(db, { templateId: s.template_id, reportType: s.report_type });
      const f = reports.formatReport(r);
      return { title: f.title, html: f.html, markdown: f.markdown };
    },
  });
  assert.equal(one.checked, 1, '单条重试应检查 1 条');
  const after = notify.listSendLogs(db, { subscription_id: subId, pageSize: 200 }).items.find((l) => l.id === failedId);
  // 钉钉记录重试仍失败（无真实 webhook）；邮件记录会成功——按渠道分别断言
  if (after.channel === 'dingtalk') {
    assert.equal(after.status, 'failed');
    assert.ok(after.retry_count >= 1, '重试次数应递增');
  }

  // 批量重试（limit=1）：手工造一条「旧」失败邮件记录（固定最小 ID + 过去的 updated_at），
  // 保证 ORDER BY id ASC LIMIT 1 必然命中本条，不被并行测试的其它失败日志抢占；
  // json transport 重发应成功。
  const BATCH_LOG_ID = 900000509;
  db.prepare(
    `INSERT INTO report_send_log
       (id, subscription_id, report_type, title, channel, recipient, status, error, retry_count, created_at, updated_at)
     VALUES (?, ?, 'daily', 's18t2_批量重试-旧记录', 'email', 'batch@example.com', 'failed', 'smtp_not_configured', 0, ?, ?)`
  ).run(
    BATCH_LOG_ID,
    subId,
    new Date(Date.now() - 3600e3).toISOString(),
    new Date(Date.now() - 3600e3).toISOString()
  );
  const batch = await notify.retryFailed(db, log, NOTIFY, {
    limit: 1,
    regenerate: (s) => {
      const r = reports.generateReport(db, { templateId: s.template_id, reportType: s.report_type });
      const f = reports.formatReport(r);
      return { title: f.title, html: f.html, markdown: f.markdown };
    },
  });
  assert.ok(batch.checked >= 1, '批量重试应检查到旧失败记录');
  const batchRow = db.prepare('SELECT * FROM report_send_log WHERE id = ?').get(BATCH_LOG_ID);
  assert.ok(batchRow, '批量重试应命中手工插入的旧记录');
  assert.equal(batchRow.status, 'success', 'json transport 批量重试应成功');
  assert.ok(batchRow.retry_count >= 1, '重试次数应递增');
  const batchAfter = notify.listSendLogs(db, { subscription_id: subId, pageSize: 200 })
    .items.find((l) => l.recipient === 'batch@example.com');
  assert.equal(batchAfter.status, 'success', 'json transport 批量重试应成功');
});

test('S18-T02 [8] dashboardLayout 默认/保存/重置', () => {
  const def = dash.getLayout(db, ADMIN_ID);
  assert.ok(Array.isArray(def.layout) && def.layout.length >= 4, '默认布局应含 4 个组件');
  assert.equal(def.layout[0].type, 'dau');
  assert.equal(def.version, 0, '未保存时版本为 0');

  const saved = dash.saveLayout(db, ADMIN_ID, [
    { type: 'funnel', title: '漏斗', width: 12, order: 0, opts: {} },
    { type: 'model', title: '模型', width: 12, order: 1, opts: {} },
  ]);
  assert.equal(saved.version, 1, '保存后版本为 1');
  assert.equal(saved.layout.length, 2);

  const got = dash.getLayout(db, ADMIN_ID);
  assert.equal(got.version, 1, '再次读取版本保持一致');
  assert.equal(got.layout[0].type, 'funnel');

  const saved2 = dash.saveLayout(db, ADMIN_ID, [{ type: 'dau', title: 'DAU', width: 24, order: 0, opts: {} }]);
  assert.equal(saved2.version, 2, '版本应乐观递增');

  const reset = dash.resetLayout(db, ADMIN_ID);
  assert.equal(reset.layout.length, 4, '重置后恢复默认 4 组件');
});

test('S18-T02 [9] exportService CSV 与 XLSX', () => {
  const columns = [
    { key: 'date', label: '日期' },
    { key: 'events', label: '事件数' },
    { key: 'note', label: '备注,含逗号"引号"与换行' },
  ];
  const rows = [
    { date: '2026-08-16', events: 120, note: '正常"数据",含,逗号' },
    { date: '2026-08-15', events: 95, note: '第二行' },
  ];

  const csv = toCSV(columns, rows);
  assert.ok(csv.startsWith('\uFEFF'), 'CSV 应含 UTF-8 BOM');
  assert.ok(csv.includes('日期,事件数'), 'CSV 应含中文表头');
  assert.ok(csv.includes('"正常""数据"",含,逗号"'), 'CSV 特殊字符应正确转义');

  const xlsx = toXLSX(columns, rows);
  assert.ok(Buffer.isBuffer(xlsx) && xlsx.length > 0, 'XLSX 应返回 Buffer');
  const head = xlsx.toString('latin1').slice(0, 2);
  assert.equal(head, 'PK', 'XLSX 应为合法 zip 包');
});
