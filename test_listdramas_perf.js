/**
 * listDramas N+1 性能测试 + listDramasLite 优化对比
 *  - 包裹 db.prepare 统计 SQL 调用次数
 *  - 对比 listDramas（含 episodes/storyboards 嵌套）vs listDramasLite（只 + episodes_count）
 *  - 多轮取平均响应时间
 */
'use strict';
const path = require('path');
process.chdir(path.join(__dirname, 'backend-node'));

const { getDb } = require('./backend-node/src/db/index.js');
const { loadConfig } = require('./backend-node/src/config/index.js');
const dramaService = require('./backend-node/src/services/dramaService');

// ---------- 建立真实 DB 连接 ----------
const cfg = loadConfig();
const db = getDb(cfg.database);

// ---------- 包裹 db.prepare 统计调用次数 ----------
let _sqlCount = 0;
let _sqlLog = [];
const origPrepare = db.prepare.bind(db);
db.prepare = function (sql) {
  _sqlCount++;
  _sqlLog.push(sql.split('\n')[0].slice(0, 80));
  return origPrepare(sql);
};
function resetCount() { _sqlCount = 0; _sqlLog = []; }
function getCount() { return _sqlCount; }

// ---------- listDramasLite 实现（优化版：单SQL预聚合 episodes_count） ----------
function listDramasLite(db, query, user = null) {
  let sql = `FROM dramas d LEFT JOIN users u ON d.created_by = u.id WHERE d.deleted_at IS NULL`;
  const params = [];
  if (query.status) { sql += ' AND d.status = ?'; params.push(query.status); }
  if (query.genre) { sql += ' AND d.genre = ?'; params.push(query.genre); }
  if (query.keyword) {
    sql += ' AND (d.title LIKE ? OR d.description LIKE ?)';
    const k = '%' + query.keyword + '%'; params.push(k, k);
  }
  const countRow = db.prepare('SELECT COUNT(DISTINCT d.id) as total ' + sql).get(...params);
  const total = countRow.total || 0;
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(query.page_size, 10) || 20));
  const offset = (page - 1) * pageSize;
  // 关键优化：用相关子查询预聚合 episodes_count，1条SQL搞定，消灭N+1
  const list = db.prepare(
    `SELECT d.*, u.nickname AS creator_nickname, u.username AS creator_username, u.user_type AS creator_user_type, u.enterprise_id AS creator_enterprise_id,
       (SELECT COUNT(*) FROM episodes e WHERE e.drama_id = d.id AND e.deleted_at IS NULL) AS episodes_count
     ${sql} ORDER BY d.updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, pageSize, offset);
  const dramas = list.map((r) => {
    const drama = dramaService.getDDramaLiteRow ? dramaService.getDDramaLiteRow(r) : _rowToDramaLite(r);
    drama.creator = {
      id: r.created_by, nickname: r.creator_nickname, username: r.creator_username,
      user_type: r.creator_user_type, enterprise_id: r.creator_enterprise_id,
    };
    drama.episodes_count = r.episodes_count;
    return drama;
  });
  return { dramas, total, page, pageSize };
}
function _rowToDramaLite(r) {
  let metadata = r.metadata;
  if (typeof metadata === 'string') { try { metadata = JSON.parse(metadata); } catch (_) { metadata = {}; } }
  return {
    id: r.id, title: r.title, description: r.description, genre: r.genre,
    style: r.style || 'realistic', status: r.status || 'draft', thumbnail: r.thumbnail,
    tags: r.tags, metadata: metadata || {}, created_at: r.created_at, updated_at: r.updated_at,
  };
}

// ---------- 计时工具 ----------
function timed(fn) {
  const t0 = process.hrtime.bigint();
  const r = fn();
  const t1 = process.hrtime.bigint();
  return { result: r, ms: Number(t1 - t0) / 1e6 };
}

// ---------- 主流程 ----------
(async () => {
  console.log('='.repeat(80));
  console.log('listDramas N+1 性能测试  (数据库:', db.type, ')');
  console.log('='.repeat(80));

  const pageSizes = [5, 10, 20, 50];
  const rounds = 3;

  console.log('\n--- 数据集概况 ---');
  resetCount();
  const stats = db.prepare('SELECT COUNT(*) as total, SUM(CASE WHEN deleted_at IS NULL THEN 1 ELSE 0 END) as live FROM dramas').get();
  console.log(`  dramas 总数=${stats.total} 未删除=${stats.live}`);
  const epStats = db.prepare('SELECT COUNT(*) as total, COUNT(DISTINCT drama_id) as dramas_with_ep FROM episodes WHERE deleted_at IS NULL').get();
  console.log(`  episodes 总数=${epStats.total} 有剧集的drama数=${epStats.dramas_with_ep}`);

  for (const ps of pageSizes) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`page_size=${ps}  (每轮跑${rounds}次取平均)`);
    console.log('='.repeat(70));

    // ---- 原版 listDramas（含N+1） ----
    let oldTotalMs = 0, oldMaxMs = 0, oldSql = 0;
    for (let i = 0; i < rounds; i++) {
      resetCount();
      const { ms } = timed(() => dramaService.listDramas(db, { page: 1, page_size: ps }, null));
      oldTotalMs += ms; if (ms > oldMaxMs) oldMaxMs = ms;
      if (i === 0) oldSql = getCount();
    }
    console.log(`  [原版 listDramas]     平均=${(oldTotalMs/rounds).toFixed(1)}ms  最慢=${oldMaxMs.toFixed(1)}ms  SQL次数(首轮)=${oldSql}`);

    // ---- 优化版 listDramasLite（消灭N+1） ----
    let newTotalMs = 0, newMaxMs = 0, newSql = 0;
    for (let i = 0; i < rounds; i++) {
      resetCount();
      const { ms } = timed(() => listDramasLite(db, { page: 1, page_size: ps }, null));
      newTotalMs += ms; if (ms > newMaxMs) newMaxMs = ms;
      if (i === 0) newSql = getCount();
    }
    console.log(`  [优化 listDramasLite] 平均=${(newTotalMs/rounds).toFixed(1)}ms  最慢=${newMaxMs.toFixed(1)}ms  SQL次数(首轮)=${newSql}`);

    const speedup = (oldTotalMs / newTotalMs).toFixed(2);
    const sqlReduction = oldSql > 0 ? ((1 - newSql / oldSql) * 100).toFixed(0) : 'N/A';
    console.log(`  → 提速 ${speedup}x   SQL减少 ${sqlReduction}%   (${oldSql} → ${newSql})`);
  }

  // ---- 验证 listDramasLite 返回结构正确 ----
  console.log(`\n${'='.repeat(70)}`);
  console.log('listDramasLite 返回结构验证');
  console.log('='.repeat(70));
  resetCount();
  const lite = listDramasLite(db, { page: 1, page_size: 3 }, null);
  console.log(`  total=${lite.total}  page=${lite.page}  pageSize=${lite.pageSize}  items=${lite.dramas.length}`);
  if (lite.dramas[0]) {
    const d = lite.dramas[0];
    console.log(`  示例item: id=${d.id} title="${d.title}" episodes_count=${d.episodes_count} creator.nickname=${d.creator.nickname} status=${d.status}`);
    console.log(`  字段完整性: ${['id','title','style','status','metadata','created_at','updated_at','creator','episodes_count'].every(k => k in d) ? '✅' : '❌'}`);
  }
  console.log(`  SQL次数=${getCount()} (期望=2: COUNT + 主查询)`);

  process.exit(0);
})().catch((e) => { console.error('脚本异常:', e); process.exit(2); });
