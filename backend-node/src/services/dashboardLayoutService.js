'use strict';

/**
 * Sprint 18 - S18-T02 自定义仪表盘布局服务
 *
 *   getLayout(db, adminId)   读取布局（无记录返回默认布局）
 *   saveLayout(db, adminId, layout)  保存布局（按管理员维度 + version 乐观版本）
 *   resetLayout(db, adminId) 重置为默认布局
 *
 * 布局 JSON 持久化到 dashboard_layout（真实 MySQL），前端 vuedraggable 拖拽后保存。
 */

const { snowflakeId } = require('../utils/snowflake');

const MAX_WIDGETS = 30;

const DEFAULT_LAYOUT = [
  { type: 'dau', title: '活跃用户趋势', width: 24, order: 0, opts: {} },
  { type: 'events', title: '事件每日趋势', width: 24, order: 1, opts: {} },
  { type: 'funnel', title: '创作转化漏斗', width: 12, order: 2, opts: {} },
  { type: 'model', title: '模型效果', width: 12, order: 3, opts: {} },
];

function nowISO() { return new Date().toISOString(); }

function parseLayout(raw) {
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : DEFAULT_LAYOUT;
  } catch (_) {
    return DEFAULT_LAYOUT;
  }
}

function getLayout(db, adminId) {
  const row = db.prepare('SELECT layout, version FROM dashboard_layout WHERE admin_id = ?').get(Number(adminId));
  if (!row) return { admin_id: Number(adminId), layout: DEFAULT_LAYOUT, version: 0 };
  return {
    admin_id: Number(adminId),
    layout: parseLayout(row.layout),
    version: Number(row.version) || 0,
  };
}

function saveLayout(db, adminId, layout) {
  const arr = Array.isArray(layout)
    ? layout.slice(0, MAX_WIDGETS).map((w, i) => ({
        type: String(w && w.type || 'dau').slice(0, 32),
        title: String(w && w.title || '').slice(0, 64),
        width: Number(w && w.width) || 24,
        order: w && w.order !== undefined ? Number(w.order) : i,
        opts: w && w.opts && typeof w.opts === 'object' ? w.opts : {},
      }))
    : [];
  const v = getLayout(db, adminId).version + 1;
  const existing = db.prepare('SELECT id FROM dashboard_layout WHERE admin_id = ?').get(Number(adminId));
  if (existing) {
    db.prepare('UPDATE dashboard_layout SET layout = ?, version = ?, updated_at = ? WHERE admin_id = ?').run(
      JSON.stringify(arr), v, nowISO(), Number(adminId)
    );
  } else {
    db.prepare(
      'INSERT INTO dashboard_layout (id, admin_id, layout, version, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).run(snowflakeId(), Number(adminId), JSON.stringify(arr), v, nowISO());
  }
  return { admin_id: Number(adminId), layout: arr, version: v };
}

function resetLayout(db, adminId) {
  return saveLayout(db, adminId, DEFAULT_LAYOUT);
}

module.exports = {
  getLayout,
  saveLayout,
  resetLayout,
  DEFAULT_LAYOUT,
  MAX_WIDGETS,
};
