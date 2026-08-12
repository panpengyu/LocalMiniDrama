'use strict';

/**
 * Sprint 12 - S12-T01/T02 素材库查询过滤共享工具
 *
 * 三张库表（character_libraries / scene_libraries / prop_libraries）的列表查询
 * 共享同一套"作用域(scope) + 标签(tags)"过滤逻辑，抽取到此处避免三处重复实现。
 *
 * 作用域（S12-T02 三级素材库）：
 *   - project  项目级：drama_id = ?（本剧资源库，兼容旧逻辑）
 *   - personal 个人级：scope='personal' AND owner_id = 当前用户
 *   - team     团队级：scope='team'     AND team_id ∈ 用户所属团队
 *   - public   公共级：scope='public'（或 drama_id IS NULL 的历史全局库）
 *
 * 标签过滤（S12-T01）：query.tags = "暖色,动漫"，可选 query.tags_match_all=1 要求全部命中。
 */

const materialTagService = require('./materialTagService');

/**
 * 依据 query 拼接作用域过滤条件。
 * @param {string} table 库表名
 * @param {object} query 请求查询参数
 * @param {string} sql   已有 SQL 片段
 * @param {any[]}  params SQL 参数数组
 * @returns {string} 追加后的 sql
 */
function appendScopeFilters(table, query, sql, params) {
  const scope = (query.scope || '').toString().trim();

  if (scope === 'personal') {
    const ownerId = Number(query.owner_id || query.user_id || (query.user && query.user.id));
    sql += " AND scope = 'personal'";
    if (ownerId) {
      sql += ' AND owner_id = ?';
      params.push(ownerId);
    }
    return sql;
  }
  if (scope === 'team') {
    sql += " AND scope = 'team'";
    const teamId = Number(query.team_id || (query.user && query.user.team_id));
    if (teamId) {
      sql += ' AND team_id = ?';
      params.push(teamId);
    }
    return sql;
  }
  if (scope === 'public') {
    sql += " AND (scope = 'public' OR drama_id IS NULL)";
    return sql;
  }
  if (scope === 'project') {
    if (query.drama_id != null && query.drama_id !== '') {
      sql += ' AND drama_id = ?';
      params.push(Number(query.drama_id));
    }
    return sql;
  }

  // 未显式指定 scope：保持与旧逻辑完全一致（global / drama_id）
  if (query.global === '1' || query.global === 1) {
    sql += ' AND drama_id IS NULL';
  } else if (query.drama_id != null && query.drama_id !== '') {
    sql += ' AND drama_id = ?';
    params.push(Number(query.drama_id));
  }
  return sql;
}

/**
 * 依据 query.tags 追加标签过滤（转成 id IN (...) 子条件）。
 * 无命中素材时返回 { sql, empty:true } 让调用方直接返回空结果。
 * @param {object} dbInst 数据库实例
 */
function appendTagFilters(dbInst, table, query, sql, params) {
  const tags = query.tags;
  if (!tags || (Array.isArray(tags) && tags.length === 0)) {
    return { sql, empty: false };
  }
  const matchAll = query.tags_match_all === '1' || query.tags_match_all === 1 || query.tags_match_all === true;
  const ids = materialTagService.searchMaterialIdsByTags(dbInst, { table, tags, matchAll });
  if (!ids.length) return { sql, empty: true };
  sql += ` AND id IN (${ids.map(() => '?').join(', ')})`;
  params.push(...ids);
  return { sql, empty: false };
}

module.exports = {
  appendScopeFilters,
  appendTagFilters,
};
