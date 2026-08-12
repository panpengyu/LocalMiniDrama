/**
 * Sprint 11 - S11-T06: 画布版本快照系统
 *
 * 职责：
 *   1. createSnapshot  —— 画布保存时自动创建一个版本快照（JSON 序列化整块 canvas_layout）
 *   2. listVersions    —— 版本列表（时间/操作者/变更摘要/节点数）
 *   3. getVersion      —— 读取单个版本完整快照
 *   4. diffVersions    —— 对比任意两个版本（节点/连线的新增、删除、修改）
 *   5. rollback        —— 一键回退到指定版本（回退动作本身也会生成一个新版本，保证历史可追溯）
 *
 * 设计要点：
 *   - 版本号 version_no 为「项目内自增序号」，通过 MAX(version_no)+1 计算，事务内加行锁避免并发重复
 *   - 快照存整块 canvas_layout（含 nodes / edges / viewport / view_mode / camera_3d 等），保证回退保真
 *   - 变更摘要基于「与上一版本 diff」自动生成，避免要求前端手工填写
 *   - 全部落地本地 MySQL，无任何 mock；SQLite 亦兼容（测试用真实库，不使用 mock 数据）
 */

'use strict';

const storageLayout = require('./storageLayout');

/**
 * 回退串行化队列（应用层「队列机制」）。
 *
 * 背景：rollback 是「读 dramas.metadata → 改 → 写回 → 同步 canvas_layouts → 建新快照」的
 * 读-改-写复合操作，且这三步无法用单个 MySQL 事务包裹（createSnapshot 内部已开事务，
 * MySQL 不支持事务嵌套，嵌套 BEGIN 会隐式提交外层）。因此在应用层为「每个 drama」维护
 * 一条串行执行链：同一项目的并发回退请求会排队，一个执行完再执行下一个，杜绝多人同时
 * 回退时读-改-写交错导致的中间态覆盖 / 版本号竞争。
 *
 * 说明：本进程内单实例后端（单连接 sync-mysql）下，队列即可保证串行；配合下方
 * dramas.updated_at 乐观锁 CAS，即便未来横向扩容为多实例，也能在数据库层兜底检测冲突。
 *
 * key: drama_id -> Promise（该项目当前排队链的尾部）
 */
const _rollbackChains = new Map();

/**
 * 将一段回退逻辑排入指定 drama 的串行队列，返回其结果 Promise。
 * @param {number} dramaId
 * @param {function} task 实际执行回退的同步函数（返回结果对象）
 * @returns {Promise<object>}
 */
function _enqueueRollback(dramaId, task) {
  const key = Number(dramaId);
  const prev = _rollbackChains.get(key) || Promise.resolve();
  // 无论上一个成功或失败，都接着排队执行当前任务（catch 吞掉前者异常仅用于链式衔接）
  const next = prev.catch(() => {}).then(() => task());
  // 记录链尾；任务结束后若自己仍是链尾则清理，避免 Map 无限增长
  _rollbackChains.set(key, next);
  next.finally(() => {
    if (_rollbackChains.get(key) === next) _rollbackChains.delete(key);
  }).catch(() => {});
  return next;
}

/**
 * 从 canvas_layout 中安全提取节点集合。
 * 兼容两种结构：nodes 为对象字典 {id:{...}} 或数组 [{...}]。
 * @returns {object} 归一化为 { [nodeId]: nodeObject }
 */
function extractNodes(layout) {
  if (!layout || typeof layout !== 'object') return {};
  const raw = layout.nodes;
  if (!raw) return {};
  if (Array.isArray(raw)) {
    const map = {};
    raw.forEach((n, idx) => {
      if (!n) return;
      const key = n.id != null ? String(n.id) : `idx_${idx}`;
      map[key] = n;
    });
    return map;
  }
  if (typeof raw === 'object') return raw;
  return {};
}

/**
 * 从 canvas_layout 中安全提取连线集合，归一化为 { [edgeKey]: edgeObject }。
 */
function extractEdges(layout) {
  if (!layout || typeof layout !== 'object') return {};
  const raw = layout.edges || layout.connections || layout.links;
  if (!raw) return {};
  const map = {};
  if (Array.isArray(raw)) {
    raw.forEach((e, idx) => {
      if (!e) return;
      const key = e.id != null ? String(e.id)
        : (e.source != null && e.target != null ? `${e.source}->${e.target}` : `idx_${idx}`);
      map[key] = e;
    });
  } else if (typeof raw === 'object') {
    Object.assign(map, raw);
  }
  return map;
}

/**
 * 稳定序列化：对对象 key 排序后 JSON.stringify，保证同一内容摘要一致（用于 diff 修改判定）。
 */
function stableStringify(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableStringify).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/**
 * 对比两个 canvas_layout，返回节点/连线的增删改。
 */
function computeDiff(prevLayout, nextLayout) {
  const prevNodes = extractNodes(prevLayout);
  const nextNodes = extractNodes(nextLayout);
  const prevEdges = extractEdges(prevLayout);
  const nextEdges = extractEdges(nextLayout);

  const diffMap = (prev, next) => {
    const added = [];
    const removed = [];
    const modified = [];
    for (const key of Object.keys(next)) {
      if (!(key in prev)) {
        added.push(key);
      } else if (stableStringify(prev[key]) !== stableStringify(next[key])) {
        modified.push(key);
      }
    }
    for (const key of Object.keys(prev)) {
      if (!(key in next)) removed.push(key);
    }
    return { added, removed, modified };
  };

  return {
    nodes: diffMap(prevNodes, nextNodes),
    edges: diffMap(prevEdges, nextEdges),
  };
}

/**
 * 依据 diff 生成中文变更摘要。
 */
function summarizeDiff(diff) {
  const parts = [];
  const n = diff.nodes;
  const e = diff.edges;
  if (n.added.length) parts.push(`新增${n.added.length}个节点`);
  if (n.removed.length) parts.push(`删除${n.removed.length}个节点`);
  if (n.modified.length) parts.push(`修改${n.modified.length}个节点`);
  if (e.added.length) parts.push(`新增${e.added.length}条连线`);
  if (e.removed.length) parts.push(`删除${e.removed.length}条连线`);
  if (e.modified.length) parts.push(`修改${e.modified.length}条连线`);
  return parts.length ? parts.join('，') : '无结构性变更';
}

/**
 * 读取项目当前 canvas_layout（来自 dramas.metadata）。
 */
function getCurrentLayout(db, dramaId) {
  const drama = db.prepare('SELECT metadata FROM dramas WHERE id = ?').get(Number(dramaId));
  if (!drama) return null;
  const meta = storageLayout.parseMetadata(drama.metadata);
  return meta.canvas_layout || null;
}

/**
 * 读取项目最新一个版本快照行（含解析后的 layout）。
 */
function getLatestVersionRow(db, dramaId) {
  const row = db.prepare(
    'SELECT * FROM canvas_versions WHERE drama_id = ? ORDER BY version_no DESC LIMIT 1'
  ).get(Number(dramaId));
  return row || null;
}

/**
 * S11-T06 核心：创建版本快照。
 *
 * @param {object} db
 * @param {object} log
 * @param {number} dramaId
 * @param {object} layout  当前完整 canvas_layout（若不传则从 metadata 读取）
 * @param {object} [opts]  { operatorId, operatorName, source='save', summary }
 * @returns {object|null}  新建的版本行 { id, version_no, change_summary, node_count, ... }
 */
function createSnapshot(db, log, dramaId, layout, opts = {}) {
  const id = Number(dramaId);
  const currentLayout = layout || getCurrentLayout(db, id);
  if (!currentLayout || typeof currentLayout !== 'object') {
    if (log && log.warn) log.warn('[S11-T06] createSnapshot skipped: 无有效 canvas_layout', { drama_id: id });
    return null;
  }

  const nodes = extractNodes(currentLayout);
  const edges = extractEdges(currentLayout);
  const nodeCount = Object.keys(nodes).length;
  const edgeCount = Object.keys(edges).length;

  // 与上一版本对比生成摘要；若无上一版本则为初始版本
  const latest = getLatestVersionRow(db, id);
  let changeSummary = opts.summary || null;
  let parentVersion = null;
  if (latest) {
    parentVersion = latest.version_no;
    if (!changeSummary) {
      let prevLayout = {};
      try { prevLayout = JSON.parse(latest.snapshot); } catch (_) { prevLayout = {}; }
      changeSummary = summarizeDiff(computeDiff(prevLayout, currentLayout));
    }
  } else if (!changeSummary) {
    changeSummary = `初始版本（${nodeCount}个节点，${edgeCount}条连线）`;
  }

  const snapshotStr = JSON.stringify(currentLayout);

  // 事务内计算 version_no（MAX+1），避免并发重复
  const insert = db.transaction(() => {
    const maxRow = db.prepare(
      'SELECT COALESCE(MAX(version_no), 0) AS mx FROM canvas_versions WHERE drama_id = ?'
    ).get(id);
    const versionNo = Number(maxRow?.mx || 0) + 1;
    const res = db.prepare(`
      INSERT INTO canvas_versions
        (drama_id, version_no, snapshot, node_count, edge_count, change_summary,
         operator_id, operator_name, source, parent_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(
      id, versionNo, snapshotStr, nodeCount, edgeCount, changeSummary,
      opts.operatorId != null ? Number(opts.operatorId) : null,
      opts.operatorName || null,
      opts.source || 'save',
      parentVersion
    );
    return { id: res.lastInsertRowid, version_no: versionNo };
  });

  const created = insert();
  const result = {
    id: created.id,
    drama_id: id,
    version_no: created.version_no,
    node_count: nodeCount,
    edge_count: edgeCount,
    change_summary: changeSummary,
    operator_id: opts.operatorId != null ? Number(opts.operatorId) : null,
    operator_name: opts.operatorName || null,
    source: opts.source || 'save',
    parent_version: parentVersion,
  };
  if (log && log.info) {
    log.info('[S11-T06] 版本快照已创建', {
      drama_id: id, version_no: created.version_no, node_count: nodeCount,
      edge_count: edgeCount, source: result.source, summary: changeSummary,
    });
  }
  return result;
}

/**
 * 版本列表（不含大字段 snapshot，避免列表接口过重）。
 * @returns {Array} [{ id, version_no, node_count, edge_count, change_summary, operator_name, source, created_at }]
 */
function listVersions(db, dramaId, limit = 100) {
  const rows = db.prepare(`
    SELECT id, drama_id, version_no, node_count, edge_count, change_summary,
           operator_id, operator_name, source, parent_version, created_at
    FROM canvas_versions
    WHERE drama_id = ?
    ORDER BY version_no DESC
    LIMIT ?
  `).all(Number(dramaId), Number(limit) || 100);
  return rows || [];
}

/**
 * 读取单个版本（含完整快照，解析为对象）。
 */
function getVersion(db, dramaId, versionNo) {
  const row = db.prepare(
    'SELECT * FROM canvas_versions WHERE drama_id = ? AND version_no = ?'
  ).get(Number(dramaId), Number(versionNo));
  if (!row) return null;
  let layout = null;
  try { layout = JSON.parse(row.snapshot); } catch (_) { layout = null; }
  return { ...row, layout };
}

/**
 * 对比两个版本，返回结构化 diff + 摘要。
 */
function diffVersions(db, dramaId, fromVersionNo, toVersionNo) {
  const from = getVersion(db, dramaId, fromVersionNo);
  const to = getVersion(db, dramaId, toVersionNo);
  if (!from) { const e = new Error(`版本 ${fromVersionNo} 不存在`); e.code = 'NOT_FOUND'; throw e; }
  if (!to) { const e = new Error(`版本 ${toVersionNo} 不存在`); e.code = 'NOT_FOUND'; throw e; }
  const diff = computeDiff(from.layout || {}, to.layout || {});
  return {
    from: { version_no: from.version_no, created_at: from.created_at, node_count: from.node_count },
    to: { version_no: to.version_no, created_at: to.created_at, node_count: to.node_count },
    diff,
    summary: summarizeDiff(diff),
  };
}

/**
 * S11-T06 回退：将画布恢复到指定版本的快照。
 *
 * 流程：
 *   1. 读取目标版本快照
 *   2. 写回 dramas.metadata.canvas_layout（保真恢复）—— 带 updated_at 乐观锁 CAS
 *   3. 同步到 canvas_layouts 表（复用 dramaService.sync3DFieldsToTable，避免循环依赖用延迟 require）
 *   4. 以 source='rollback' 再创建一个新版本（保证历史线性可追溯，不销毁中间版本）
 *
 * 并发防护（多人同时回退）：
 *   - 队列机制：同一 drama 的回退经 _enqueueRollback 串行化，杜绝读-改-写交错
 *   - 乐观锁：UPDATE dramas ... WHERE id=? AND updated_at=<读取时的值>，若 changes===0
 *     说明期间已被他人修改，抛出 CONFLICT，避免「后写覆盖先写」（last-write-wins）
 *
 * @returns {Promise<object>} { restored_version, new_version }
 */
function rollback(db, log, dramaId, targetVersionNo, opts = {}) {
  const id = Number(dramaId);
  // 排入该项目的串行队列，返回 Promise（路由需 await）
  return _enqueueRollback(id, () => _rollbackInner(db, log, id, targetVersionNo, opts));
}

/**
 * 回退的实际执行体（已在串行队列中，同一 drama 不会并发进入）。
 */
function _rollbackInner(db, log, id, targetVersionNo, opts = {}) {
  const target = getVersion(db, id, targetVersionNo);
  if (!target || !target.layout) {
    const e = new Error(`回退目标版本 ${targetVersionNo} 不存在或快照损坏`);
    e.code = 'NOT_FOUND';
    throw e;
  }

  // 读取当前 metadata 与 updated_at 作为乐观锁基准。
  // 注意：MySQL 侧 sync-mysql 会把 DATETIME 以 ISO 字符串（含 T/Z、UTC 时区）返回，
  // 直接回填到 WHERE updated_at = ? 会因时区/格式差异比对落空。因此统一用
  // DATE_FORMAT 取「会话本地时区的 'YYYY-MM-DD HH:MM:SS' 字符串」作为 CAS 令牌，
  // 并在 WHERE 中同样用 DATE_FORMAT 比对，规避驱动层日期格式化歧义。
  const isMysql = db.type === 'mysql';
  const drama = isMysql
    ? db.prepare("SELECT metadata, DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS ua_token FROM dramas WHERE id = ?").get(id)
    : db.prepare('SELECT metadata, updated_at AS ua_token FROM dramas WHERE id = ?').get(id);
  if (!drama) { const e = new Error('项目不存在'); e.code = 'NOT_FOUND'; throw e; }

  const meta = storageLayout.parseMetadata(drama.metadata);
  meta.canvas_layout = target.layout;
  const now = new Date().toISOString();

  // 乐观锁 CAS：仅当 updated_at 未变（无人在读取后抢先修改）时才写入。
  // ua_token 为 NULL 时退化为 IS NULL 条件，保证历史数据也能命中。
  const prevToken = drama.ua_token;
  let cas;
  if (prevToken == null) {
    cas = isMysql
      ? db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ? AND updated_at IS NULL')
          .run(JSON.stringify(meta), now, id)
      : db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ? AND updated_at IS NULL')
          .run(JSON.stringify(meta), now, id);
  } else if (isMysql) {
    cas = db.prepare("UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ? AND DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') = ?")
      .run(JSON.stringify(meta), now, id, prevToken);
  } else {
    cas = db.prepare('UPDATE dramas SET metadata = ?, updated_at = ? WHERE id = ? AND updated_at = ?')
      .run(JSON.stringify(meta), now, id, prevToken);
  }

  if (!cas || Number(cas.changes) === 0) {
    const e = new Error('项目画布在回退期间已被其他操作修改，请刷新后重试');
    e.code = 'CONFLICT';
    if (log && log.warn) {
      log.warn('[S11-T06] rollback 乐观锁冲突', { drama_id: id, target_version: targetVersionNo });
    }
    throw e;
  }

  // 同步到 canvas_layouts 表（延迟 require 规避与 dramaService 的循环依赖）
  try {
    const dramaService = require('./dramaService');
    if (typeof dramaService._sync3DFieldsToTable === 'function') {
      dramaService._sync3DFieldsToTable(db, id, target.layout, log);
    }
  } catch (err) {
    if (log && log.warn) log.warn('[S11-T06] rollback 同步 canvas_layouts 失败(非致命)', { error: err.message });
  }

  // 回退动作本身生成新版本
  const newVersion = createSnapshot(db, log, id, target.layout, {
    operatorId: opts.operatorId,
    operatorName: opts.operatorName,
    source: 'rollback',
    summary: `回退到版本 v${target.version_no}`,
  });

  if (log && log.info) {
    log.info('[S11-T06] 画布已回退', {
      drama_id: id, restored_version: target.version_no, new_version: newVersion?.version_no,
    });
  }

  return {
    restored_version: target.version_no,
    new_version: newVersion ? newVersion.version_no : null,
    layout: target.layout,
  };
}

module.exports = {
  createSnapshot,
  listVersions,
  getVersion,
  diffVersions,
  rollback,
  // 导出内部工具以便测试与复用
  computeDiff,
  summarizeDiff,
  extractNodes,
  extractEdges,
  _rollbackInner,
};
