'use strict';

/**
 * Sprint 14 - S14-T04 模板审核流程
 *
 * 审核状态机（marketplace_templates.status）：
 *
 *   draft ──submit──▶ pending ──AI预审──▶ ┌ ai_passed ──人工approve──▶ listed
 *                                          └ rejected(AI直接驳回严重违规)
 *   ai_passed ──人工reject──▶ rejected
 *   rejected ──creator编辑后resubmit──▶ pending（回到流程起点）
 *   listed ──admin delist──▶ delisted ──admin relist──▶ listed
 *
 * 流程说明：
 *   1) 提交审核（submit）：创作者把 draft/rejected/delisted 的模板提交，进入 pending。
 *   2) AI 预审（runAiReview）：对标题/简介/描述/标签做文本合规检测（复用
 *      contentModerationService 的内置文本审核 + 规则阈值），产出综合分与是否通过：
 *        - 命中「阻断类」违规（porn/violence/political 且达到阻断阈值）→ 直接 rejected；
 *        - 命中「复核类」（spam/copyright 或分数偏高）→ 标记 ai_passed 但提示人工重点复核；
 *        - 无风险 → ai_passed，等待人工复审。
 *      提交审核时自动串联执行 AI 预审（submitForReview 内部调用），保证「提交→AI预审」连贯。
 *   3) 人工复审（manualReview）：管理员对 pending/ai_passed 的模板 approve（上架 listed，
 *      写 listed_at，刷新创作者上架模板数）或 reject（驳回 rejected，记录 reject_reason）。
 *   4) 上下架（delist/relist）：管理员对已上架模板临时下架或恢复。
 *
 * 每一次状态流转都写入 marketplace_review_logs（AI 与人工的完整审计轨迹）。
 *
 * 数据存储：全部落地本地 MySQL（marketplace_templates / marketplace_review_logs），无 mock。
 */

const contentModerationService = require('./contentModerationService');
const creatorService = require('./creatorService');

function nowExpr(db) {
  return db.type === 'mysql' ? 'NOW()' : "datetime('now')";
}

// 阻断类风险标签（命中且达阈值直接驳回）
const BLOCK_LABELS = ['porn', 'violence', 'political'];
// 可提交审核的前置状态
const SUBMITTABLE = ['draft', 'rejected', 'delisted'];
// 人工复审的合法状态
const MANUAL_REVIEWABLE = ['pending', 'ai_passed', 'ai_reviewing'];

function getRawTemplate(db, templateId) {
  return db.prepare('SELECT * FROM marketplace_templates WHERE id = ? AND is_deleted = 0').get(Number(templateId));
}

/** 记录一条审核流水。 */
function writeReviewLog(db, { templateId, reviewType, action, fromStatus, toStatus, score, reviewerId, remark, detail }) {
  db.prepare(
    `INSERT INTO marketplace_review_logs
       (template_id, review_type, action, from_status, to_status, score, reviewer_id, remark, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${nowExpr(db)})`
  ).run(
    Number(templateId), reviewType, action, fromStatus || null, toStatus || null,
    score == null ? null : Number(score), reviewerId || null, remark || null,
    detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail))
  );
}

// ===========================================================================
// AI 预审
// ===========================================================================

/**
 * 对模板文本内容执行 AI 预审（同步，可在事务内调用）。
 * 采集标题 + 简介 + 描述 + 标签，逐段跑内置文本审核，取最高风险分，并按审核规则判定动作。
 * @returns {{ score, passed, blocked, verdict, riskLabel, action, segments }}
 */
function evaluateTemplateContent(db, t, { mode = 'standard' } = {}) {
  const tags = (() => {
    try { const arr = JSON.parse(t.tags || '[]'); return Array.isArray(arr) ? arr.join(' ') : ''; } catch (_) { return ''; }
  })();
  const segments = [
    { field: 'title', text: t.title || '' },
    { field: 'summary', text: t.summary || '' },
    { field: 'description', text: t.description || '' },
    { field: 'tags', text: tags },
  ].filter((s) => s.text && String(s.text).trim());

  const rules = contentModerationService.getRules(db, mode);
  let maxScore = 0;
  let worstLabel = 'safe';
  let blocked = false;
  const hitDetails = [];

  for (const seg of segments) {
    const r = contentModerationService.moderateTextBuiltin(seg.text);
    if (r.riskScore > maxScore) { maxScore = r.riskScore; worstLabel = r.riskLabel; }
    if (r.verdict === 'violation') {
      hitDetails.push({ field: seg.field, riskLabel: r.riskLabel, riskScore: r.riskScore, details: r.details });
      // 命中阻断类且达到该类阻断阈值 → 直接驳回
      const rule = rules[r.riskLabel];
      if (rule && rule.action === 'block' && BLOCK_LABELS.includes(r.riskLabel) && r.riskScore >= rule.threshold) {
        blocked = true;
      }
    }
  }

  // 综合分：内置引擎风险分越高，合规分越低（0~100，越高越安全）
  const complianceScore = +(100 - maxScore).toFixed(2);
  const rule = rules[worstLabel] || { threshold: 70, action: 'review' };
  const action = blocked ? 'block' : (maxScore > 0 && maxScore >= (rule.threshold || 70) ? 'review' : 'pass');

  return {
    score: complianceScore,
    passed: !blocked,
    blocked,
    verdict: blocked ? 'violation' : (hitDetails.length ? 'suspect' : 'safe'),
    riskLabel: worstLabel,
    action,
    segments: hitDetails,
    mode,
  };
}

/**
 * 执行 AI 预审并落库（更新模板 ai_* 字段 + 状态 + 审核流水）。
 * 在同一事务内被 submitForReview 调用。
 */
function runAiReview(db, log, templateId, { mode = 'standard', triggeredBy = null } = {}) {
  const t = getRawTemplate(db, templateId);
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }

  const evalResult = evaluateTemplateContent(db, t, { mode });
  const passed = evalResult.passed;
  // AI 通过 → ai_passed（等待人工复审）；AI 阻断 → rejected（严重违规直接驳回）
  const toStatus = passed ? 'ai_passed' : 'rejected';

  db.prepare(
    `UPDATE marketplace_templates
       SET status = ?, ai_review_score = ?, ai_review_passed = ?, ai_review_detail = ?,
           reject_reason = CASE WHEN ? = 'rejected' THEN ? ELSE reject_reason END,
           updated_at = ${nowExpr(db)}
     WHERE id = ?`
  ).run(
    toStatus, evalResult.score, passed ? 1 : 0, JSON.stringify(evalResult),
    toStatus, passed ? null : `AI 预审拦截：命中${evalResult.riskLabel}类高风险内容`,
    Number(templateId)
  );

  writeReviewLog(db, {
    templateId, reviewType: 'ai', action: passed ? 'ai_pass' : 'ai_reject',
    fromStatus: 'pending', toStatus, score: evalResult.score, reviewerId: null,
    remark: passed
      ? (evalResult.action === 'review' ? 'AI 预审通过，建议人工重点复核' : 'AI 预审通过')
      : `AI 预审驳回：${evalResult.riskLabel}`,
    detail: evalResult,
  });

  if (log) log.info('[S14-T04] AI 预审完成', { templateId, passed, score: evalResult.score, label: evalResult.riskLabel, triggeredBy });
  return { status: toStatus, aiReview: evalResult };
}

// ===========================================================================
// 提交审核（创作者，串联 AI 预审）
// ===========================================================================

/**
 * 创作者提交模板审核。
 * 前置：模板属于本人，且状态为 draft/rejected/delisted。
 * 事务内：状态置 pending → 立即执行 AI 预审 → 得到 ai_passed / rejected。
 * @param {object} opts { templateId, creator, mode }
 */
function submitForReview(db, log, { templateId, creator, mode = 'standard' }) {
  const t = getRawTemplate(db, templateId);
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }
  if (Number(t.creator_id) !== Number(creator.id)) { const e = new Error('无权提交他人模板'); e.code = 'FORBIDDEN'; throw e; }
  if (!SUBMITTABLE.includes(t.status)) {
    const e = new Error(`当前状态不可提交审核：${t.status}`); e.code = 'NOT_SUBMITTABLE'; throw e;
  }
  // 内容体不能为空
  const content = (() => { try { return JSON.parse(t.content_json || '{}'); } catch (_) { return {}; } })();
  const hasContent = content && (Array.isArray(content.character_presets) && content.character_presets.length
    || Array.isArray(content.scene_presets) && content.scene_presets.length
    || content.style_config);
  if (!hasContent) {
    const e = new Error('模板内容为空，请先完善角色/场景/风格预设再提交'); e.code = 'EMPTY_TEMPLATE_CONTENT'; throw e;
  }

  const action = t.status === 'rejected' ? 'resubmit' : 'submit';

  const runTx = () => {
    db.prepare(
      `UPDATE marketplace_templates SET status = 'pending', reject_reason = NULL, updated_at = ${nowExpr(db)} WHERE id = ?`
    ).run(Number(templateId));
    writeReviewLog(db, {
      templateId, reviewType: 'submit', action, fromStatus: t.status, toStatus: 'pending',
      reviewerId: null, remark: action === 'resubmit' ? '驳回后重新提交审核' : '提交审核',
    });
    // 串联 AI 预审
    return runAiReview(db, log, templateId, { mode, triggeredBy: 'submit' });
  };
  const result = db.transaction ? db.transaction(runTx)() : runTx();
  if (log) log.info('[S14-T04] 提交审核', { templateId, creatorId: creator.id, aiStatus: result.status });
  return getReviewState(db, templateId);
}

// ===========================================================================
// 人工复审（管理端）
// ===========================================================================

/**
 * 管理员人工复审。
 * @param {object} opts { templateId, approve, remark, reviewerId }
 *   approve=true  → listed（上架，写 listed_at，刷新创作者上架模板数）
 *   approve=false → rejected（驳回，记录 reject_reason）
 */
function manualReview(db, log, { templateId, approve, remark, reviewerId }) {
  const t = getRawTemplate(db, templateId);
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }
  if (!MANUAL_REVIEWABLE.includes(t.status)) {
    const e = new Error(`当前状态不可人工复审：${t.status}`); e.code = 'NOT_REVIEWABLE'; throw e;
  }
  if (!approve && !remark) { const e = new Error('驳回必须填写原因'); e.code = 'REJECT_REASON_REQUIRED'; throw e; }

  const toStatus = approve ? 'listed' : 'rejected';
  const inList = MANUAL_REVIEWABLE.map(() => '?').join(',');
  const runTx = () => {
    // 原子状态流转：UPDATE 自带 status 前置条件，changes===1 者才是本次并发的唯一赢家。
    // 避免「读取(guard)→写入」之间的 TOCTOU 窗口导致多个并发复审同时通过、写重复审计日志。
    let changed;
    if (approve) {
      changed = db.prepare(
        `UPDATE marketplace_templates
           SET status = 'listed', reviewer_id = ?, reviewed_at = ${nowExpr(db)},
               listed_at = COALESCE(listed_at, ${nowExpr(db)}), reject_reason = NULL, updated_at = ${nowExpr(db)}
         WHERE id = ? AND status IN (${inList})`
      ).run(reviewerId || null, Number(templateId), ...MANUAL_REVIEWABLE).changes;
    } else {
      changed = db.prepare(
        `UPDATE marketplace_templates
           SET status = 'rejected', reviewer_id = ?, reviewed_at = ${nowExpr(db)}, reject_reason = ?, updated_at = ${nowExpr(db)}
         WHERE id = ? AND status IN (${inList})`
      ).run(reviewerId || null, remark, Number(templateId), ...MANUAL_REVIEWABLE).changes;
    }
    // 并发下未抢到状态流转（changes===0）：状态已被其它复审改变，判定为不可复审。
    if (!changed) { const e = new Error(`当前状态不可人工复审：已被处理`); e.code = 'NOT_REVIEWABLE'; throw e; }
    if (approve) creatorService.bumpCreatorTemplateCount(db, t.creator_id);
    writeReviewLog(db, {
      templateId, reviewType: 'manual', action: approve ? 'approve' : 'reject',
      fromStatus: t.status, toStatus, reviewerId: reviewerId || null,
      remark: remark || (approve ? '人工复审通过，准予上架' : '人工复审驳回'),
    });
  };
  db.transaction ? db.transaction(runTx)() : runTx();
  if (log) log.info('[S14-T04] 人工复审', { templateId, approve: !!approve, reviewerId, toStatus });
  return getReviewState(db, templateId);
}

/**
 * 上下架（管理端）。
 * @param {object} opts { templateId, listed, reviewerId, remark }
 *   listed=false → delisted（下架，刷新创作者上架数）
 *   listed=true  → listed（恢复上架）
 */
function setListing(db, log, { templateId, listed, reviewerId, remark }) {
  const t = getRawTemplate(db, templateId);
  if (!t) { const e = new Error('模板不存在'); e.code = 'TEMPLATE_NOT_FOUND'; throw e; }

  if (listed) {
    if (t.status !== 'delisted') { const e = new Error('仅已下架模板可恢复上架'); e.code = 'NOT_DELISTED'; throw e; }
  } else if (t.status !== 'listed') {
    const e = new Error('仅已上架模板可下架'); e.code = 'NOT_LISTED'; throw e;
  }

  const toStatus = listed ? 'listed' : 'delisted';
  const fromRequired = listed ? 'delisted' : 'listed';
  const runTx = () => {
    // 原子上下架：UPDATE 自带 from 状态前置条件，防并发重复流转与重复审计。
    const changed = db.prepare(
      `UPDATE marketplace_templates
         SET status = ?, listed_at = CASE WHEN ? = 'listed' THEN COALESCE(listed_at, ${nowExpr(db)}) ELSE listed_at END,
             updated_at = ${nowExpr(db)}
       WHERE id = ? AND status = ?`
    ).run(toStatus, toStatus, Number(templateId), fromRequired).changes;
    if (!changed) {
      const e = new Error(listed ? '仅已下架模板可恢复上架' : '仅已上架模板可下架');
      e.code = listed ? 'NOT_DELISTED' : 'NOT_LISTED';
      throw e;
    }
    creatorService.bumpCreatorTemplateCount(db, t.creator_id);
    writeReviewLog(db, {
      templateId, reviewType: 'manual', action: listed ? 'relist' : 'delist',
      fromStatus: t.status, toStatus, reviewerId: reviewerId || null,
      remark: remark || (listed ? '恢复上架' : '下架'),
    });
  };
  db.transaction ? db.transaction(runTx)() : runTx();
  if (log) log.info('[S14-T04] 上下架', { templateId, listed: !!listed, reviewerId });
  return getReviewState(db, templateId);
}

// ===========================================================================
// 查询
// ===========================================================================

/** 模板当前审核状态与最近一次 AI 预审结果。 */
function getReviewState(db, templateId) {
  const t = getRawTemplate(db, templateId);
  if (!t) return null;
  let aiDetail = null;
  try { aiDetail = t.ai_review_detail ? JSON.parse(t.ai_review_detail) : null; } catch (_) { aiDetail = null; }
  return {
    template_id: t.id,
    template_no: t.template_no,
    title: t.title,
    status: t.status,
    ai_review_score: t.ai_review_score == null ? null : Number(t.ai_review_score),
    ai_review_passed: t.ai_review_passed == null ? null : !!t.ai_review_passed,
    ai_review_detail: aiDetail,
    reject_reason: t.reject_reason || null,
    reviewer_id: t.reviewer_id || null,
    reviewed_at: t.reviewed_at || null,
    listed_at: t.listed_at || null,
  };
}

/** 模板审核流水（时间正序，展示完整轨迹）。 */
function listReviewLogs(db, templateId, { limit = 50 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  const rows = db.prepare(
    `SELECT * FROM marketplace_review_logs WHERE template_id = ? ORDER BY created_at ASC, id ASC LIMIT ?`
  ).all(Number(templateId), lim) || [];
  return rows.map((r) => ({
    ...r,
    detail_json: (() => { try { return r.detail_json ? JSON.parse(r.detail_json) : null; } catch (_) { return null; } })(),
  }));
}

/**
 * 审核工作台队列（管理端）：默认列出待复审（pending/ai_reviewing/ai_passed）。
 * @param {object} q { status, page, pageSize }
 */
function listReviewQueue(db, { status, page, pageSize } = {}) {
  const params = [];
  let where = 'WHERE t.is_deleted = 0';
  if (status && status !== 'all') {
    where += ' AND t.status = ?';
    params.push(String(status));
  } else {
    where += " AND t.status IN ('pending','ai_reviewing','ai_passed')";
  }
  const total = Number(db.prepare(`SELECT COUNT(*) AS c FROM marketplace_templates t ${where}`).get(...params).c || 0);
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
  const items = db.prepare(
    `SELECT t.id, t.template_no, t.title, t.summary, t.category, t.genre_type, t.pricing_type, t.price,
            t.status, t.ai_review_score, t.ai_review_passed, t.cover_image,
            t.creator_id, t.creator_user_id, t.created_at, t.updated_at,
            c.display_name AS creator_name
     FROM marketplace_templates t
     LEFT JOIN marketplace_creators c ON c.id = t.creator_id
     ${where}
     ORDER BY t.updated_at ASC, t.id ASC
     LIMIT ? OFFSET ?`
  ).all(...params, ps, (p - 1) * ps) || [];
  return { items, total, page: p, pageSize: ps };
}

module.exports = {
  BLOCK_LABELS,
  SUBMITTABLE,
  MANUAL_REVIEWABLE,
  evaluateTemplateContent,
  runAiReview,
  submitForReview,
  manualReview,
  setListing,
  getReviewState,
  listReviewLogs,
  listReviewQueue,
  writeReviewLog,
};
