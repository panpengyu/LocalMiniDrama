'use strict';
/**
 * contentModerationService.js
 * Sprint 4 - S4-T08 内容审核服务
 *
 * 功能：AI辅助内容审核 + 违规拦截 + 审核记录
 *   - 文本审核：违禁词/敏感内容过滤
 *   - 图片审核：调用外部安全API（可配置），内置启发式检测
 *   - 审核模式：strict/standard/loose
 *   - 审核记录：完整日志，支持申诉和回溯
 *
 * 架构：
 *   1. 内置审核引擎（builtin）：关键词匹配 + 规则评分，无需外部依赖
 *   2. 外部审核API（可配置）：阿里云绿网/腾讯云天御，通过 ai_service_configs 配置
 *   3. 审核结果落库 content_moderation_logs
 */

const https = require('https');
const http = require('http');

// ---------- 工具 ----------
function nowStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ---------- 内置违禁词库（按风险分类） ----------
// 注意：此处为通用敏感词示例，生产环境应从数据库或配置文件加载完整词库
const SENSITIVE_WORDS = {
  porn: ['色情', '裸体', '成人视频', 'av女优', '黄片', '卖淫', '嫖娼'],
  violence: ['杀人', '炸弹', '恐怖袭击', '分尸', '血腥屠杀', '自残', '自杀方法'],
  political: ['反动', '颠覆政权', '分裂国家', '恐怖主义', '极端组织'],
  spam: ['免费领取', '点击链接', '加微信', '代开发票', '刷单', '赌博网站'],
  copyright: ['盗版资源', '破解版下载', '免费观看VIP'],
};

// ---------- 审核规则读取 ----------

/**
 * 从数据库读取审核模式下的规则阈值
 */
function getRules(db, mode) {
  mode = mode || 'standard';
  try {
    const rows = db.prepare('SELECT category, threshold, action FROM content_moderation_rules WHERE mode = ? AND is_active = 1').all(mode);
    if (rows.length) {
      const map = {};
      for (const r of rows) map[r.category] = { threshold: Number(r.threshold), action: r.action };
      return map;
    }
  } catch (_) {}
  // 兜底默认值
  const defaults = {
    strict:   { porn: { threshold: 30, action: 'block' }, violence: { threshold: 40, action: 'block' }, political: { threshold: 30, action: 'block' }, spam: { threshold: 50, action: 'review' }, copyright: { threshold: 40, action: 'review' } },
    standard: { porn: { threshold: 60, action: 'block' }, violence: { threshold: 70, action: 'block' }, political: { threshold: 60, action: 'block' }, spam: { threshold: 70, action: 'review' }, copyright: { threshold: 60, action: 'review' } },
    loose:    { porn: { threshold: 80, action: 'block' }, violence: { threshold: 85, action: 'block' }, political: { threshold: 80, action: 'block' }, spam: { threshold: 85, action: 'review' }, copyright: { threshold: 80, action: 'review' } },
  };
  return defaults[mode] || defaults.standard;
}

// ---------- 内置文本审核 ----------

/**
 * 内置文本审核：关键词匹配 + 评分
 * @returns {{ verdict, riskLabel, riskScore, confidence, details }}
 */
function moderateTextBuiltin(text) {
  if (!text || typeof text !== 'string') {
    return { verdict: 'safe', riskLabel: 'safe', riskScore: 0, confidence: 100, details: [] };
  }
  const lower = text.toLowerCase();
  const details = [];
  let maxScore = 0;
  let maxLabel = 'safe';

  for (const [category, words] of Object.entries(SENSITIVE_WORDS)) {
    let hits = 0;
    const hitWords = [];
    for (const w of words) {
      if (lower.includes(w.toLowerCase())) { hits++; hitWords.push(w); }
    }
    if (hits > 0) {
      // 每个命中词贡献分数：基础30分 + 每多一个词+15分，上限100
      const score = Math.min(100, 30 + (hits - 1) * 15);
      details.push({ category, hits, hitWords, score });
      if (score > maxScore) { maxScore = score; maxLabel = category; }
    }
  }

  const verdict = maxScore === 0 ? 'safe' : 'violation';
  return {
    verdict,
    riskLabel: maxLabel,
    riskScore: maxScore,
    confidence: maxScore > 0 ? 85 : 100,
    details,
  };
}

// ---------- 内置图片审核（启发式） ----------

/**
 * 内置图片审核：基于URL/文件名的启发式检测
 * 完整的图片视觉审核需接入外部API（阿里云绿网/腾讯云天御）
 */
function moderateImageBuiltin(imageUrl, contentSnapshot) {
  let score = 0;
  const details = [];
  const lower = String(imageUrl || '').toLowerCase();

  // URL特征检测
  const suspiciousPatterns = ['nude', 'nsfw', 'adult', 'xxx', 'porn'];
  for (const p of suspiciousPatterns) {
    if (lower.includes(p)) { score = Math.max(score, 80); details.push({ type: 'url_pattern', pattern: p, score: 80 }); }
  }

  // 文件名敏感词
  const snapshot = String(contentSnapshot || '').toLowerCase();
  for (const p of suspiciousPatterns) {
    if (snapshot.includes(p)) { score = Math.max(score, 70); details.push({ type: 'filename_pattern', pattern: p, score: 70 }); }
  }

  return {
    verdict: score >= 60 ? 'violation' : 'safe',
    riskLabel: score >= 60 ? 'porn' : 'safe',
    riskScore: score,
    confidence: score > 0 ? 70 : 50,
    details,
    note: score === 0 ? '内置启发式检测未发现风险，建议接入外部视觉审核API获取更准确结果' : undefined,
  };
}

// ---------- 外部API审核（可配置） ----------

/**
 * 调用外部内容安全API
 * 通过 ai_service_configs 中 service_type='moderation' 的配置调用
 * 支持 provider: aliyun_green / tencent_youtu
 */
async function moderateWithExternalApi(db, log, config, params) {
  log = log || console;
  const { type, content } = params; // type: text/image, content: 文本或图片URL
  const provider = (config.provider || '').toLowerCase();

  // 外部API调用需要配置 api_key 和 endpoint
  // 此处实现通用HTTP调用框架，具体签名算法按供应方文档实现
  // 若未配置外部API，返回 null 表示降级到内置审核
  if (!config.api_key || !config.endpoint) return null;

  try {
    if (provider === 'aliyun_green') {
      // 阿里云绿网：POST JSON { content, type }
      return await _callExternalApi(config, { type, content });
    } else if (provider === 'tencent_youtu') {
      // 腾讯云天御：POST JSON { content, type }
      return await _callExternalApi(config, { type, content });
    }
  } catch (err) {
    log.warn('[MODERATION] 外部API调用失败，降级到内置审核', { error: err.message, provider });
  }
  return null;
}

function _callExternalApi(config, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(config.endpoint);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${String(config.api_key).replace(/[\x00-\x1F\x7F]/g, '')}`,
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`外部审核API HTTP ${res.statusCode}`));
          return;
        }
        try {
          const data = JSON.parse(buf.toString());
          resolve({
            verdict: data.verdict || data.suggest || 'safe',
            riskLabel: data.risk_label || data.label || 'safe',
            riskScore: Number(data.risk_score || data.score || 0),
            confidence: Number(data.confidence || 90),
            details: data.details || [],
          });
        } catch (e) { reject(e); }
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('外部审核API超时')); }, 15000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

// ---------- 核心：审核入口 ----------

/**
 * 审核内容（统一入口）
 * @param {object} db - 数据库
 * @param {object} log - 日志
 * @param {object} params - { resourceType, resourceId, resourceUrl, contentSnapshot, mode, userId, dramaId }
 * @returns {object} { verdict, riskLabel, riskScore, confidence, isBlocked, logId }
 */
async function moderate(db, log, params) {
  log = log || console;
  const t0 = Date.now();
  const trace = `[MOD#${Math.random().toString(36).slice(2, 8)}]`;

  const { resourceType, resourceId, resourceUrl, contentSnapshot, mode = 'standard', userId, dramaId } = params;

  // --- 参数校验 ---
  if (!['text', 'image', 'video'].includes(resourceType)) {
    log.error(`${trace} 参数校验失败: 不支持的 resourceType=${resourceType}`);
    throw new Error('resourceType 必须为 text/image/video');
  }

  log.info(`${trace} ┌── 内容审核任务启动 ──────────────`);
  log.info(`${trace} │ resourceType=${resourceType}  resourceId=${resourceId}  userId=${userId}  dramaId=${dramaId}`);
  log.info(`${trace} │ mode=${mode}`);
  const content = contentSnapshot || resourceUrl || '';
  // 仅打印前 60 字，避免泄露全文到日志
  const preview = String(content).slice(0, 60).replace(/[\r\n\t]/g, ' ');
  log.info(`${trace} │ contentLen=${String(content).length}chars  预览: "${preview}${String(content).length > 60 ? '..."' : '"'}`);

  // --- 阶段 1: 定位外部审核 API 配置 ---
  const t1 = Date.now();
  let externalConfig = null;
  try {
    const aiConfigService = require('./aiConfigService');
    const configs = aiConfigService.listConfigs(db, 'moderation');
    externalConfig = configs.find(c => c.is_active) || configs[0] || null;
    log.info(`${trace} ├─[配置加载] ${Date.now() - t1}ms  可用审核配置数=${configs.length}  选中=${externalConfig ? `${externalConfig.provider} (id=${externalConfig.id})` : '无（使用内置审核）'}`);
  } catch (e) {
    log.warn(`${trace} ├─[配置加载] 失败: ${e.message}，将降级到内置审核`);
    externalConfig = null;
  }

  // --- 阶段 2: 外部 API 审核 ---
  const t2 = Date.now();
  let result = null;
  let usedExternal = false;
  let externalError = null;
  if (externalConfig) {
    try {
      log.info(`${trace} ├─[外部审核] 调用 provider=${externalConfig.provider} endpoint=${externalConfig.endpoint ? externalConfig.endpoint.slice(0, 40) + '...' : 'N/A'}`);
      const extResult = await moderateWithExternalApi(db, log, externalConfig, {
        type: resourceType === 'text' ? 'text' : 'image',
        content,
      });
      if (extResult) {
        result = extResult;
        usedExternal = true;
        log.info(`${trace} │ 成功! 耗时=${Date.now() - t2}ms  verdict=${result.verdict}  label=${result.riskLabel}  score=${result.riskScore}  conf=${result.confidence}%`);
      } else {
        log.warn(`${trace} │ 返回 null，降级到内置审核（配置缺失 endpoint/api_key 或供应方未知）`);
      }
    } catch (err) {
      externalError = err;
      log.error(`${trace} ├─[外部审核] 异常! 耗时=${Date.now() - t2}ms  error=${err.name}: ${err.message}`);
      log.warn(`${trace} │ 降级到内置审核`);
    }
  }

  // --- 阶段 3: 内置审核（兜底） ---
  const t3 = Date.now();
  if (!result) {
    if (resourceType === 'text') {
      result = moderateTextBuiltin(content);
      const hitCount = (result.details || []).reduce((n, d) => n + (d.hits || 0), 0);
      log.info(`${trace} ├─[内置文本审核] ${Date.now() - t3}ms  verdict=${result.verdict}  label=${result.riskLabel}  score=${result.riskScore}  命中关键词=${hitCount}`);
      if ((result.details || []).length) {
        log.info(`${trace} │ 命中详情: ${result.details.map(d => `${d.category}[${d.hitWords.join(',')}]→${d.score}分`).join(' ; ')}`);
      }
    } else {
      result = moderateImageBuiltin(resourceUrl, content);
      log.info(`${trace} ├─[内置图片审核] ${Date.now() - t3}ms  verdict=${result.verdict}  label=${result.riskLabel}  score=${result.riskScore}  匹配=${result.details.length ? result.details.map(d => d.pattern).join(',') : '无'}`);
    }
  }

  // --- 阶段 4: 审核规则判定 ---
  const t4 = Date.now();
  const rules = getRules(db, mode);
  const rule = rules[result.riskLabel] || { threshold: 70, action: 'review' };
  log.info(`${trace} ├─[规则判定] ${Date.now() - t4}ms  mode=${mode}  类别=${result.riskLabel}  阈值=${rule.threshold}  处置=${rule.action}`);
  log.info(`${trace} │ riskScore=${result.riskScore}  ≥ 阈值? ${result.riskScore >= rule.threshold ? '是' : '否'}  action === 'block'? ${rule.action === 'block' ? '是' : '否'}`);
  const isBlocked = result.riskScore >= rule.threshold && rule.action === 'block';
  const finalVerdict = isBlocked ? 'violation' : (result.riskScore >= rule.threshold && rule.action === 'review' ? 'pending' : 'safe');
  log.info(`${trace} │ → 最终结论: verdict=${finalVerdict}  isBlocked=${isBlocked}`);

  // --- 阶段 5: 审核日志落库 ---
  const t5 = Date.now();
  let logId = null;
  let dbStatus = 'ok';
  try {
    const ins = db.prepare(`INSERT INTO content_moderation_logs
      (user_id, drama_id, resource_type, resource_id, resource_url, content_snapshot,
       provider, verdict, risk_label, risk_score, confidence, detail_json, mode, is_blocked, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId || null, dramaId || null, resourceType, resourceId || null, resourceUrl || null,
      String(content).slice(0, 2000),
      externalConfig ? externalConfig.provider : 'builtin',
      finalVerdict, result.riskLabel, result.riskScore, result.confidence,
      JSON.stringify(result.details || {}),
      mode, isBlocked ? 1 : 0, nowStr(), nowStr()
    );
    logId = ins.lastInsertRowid;
    log.info(`${trace} ├─[落库] ${Date.now() - t5}ms  logId=${logId}`);
  } catch (e) {
    dbStatus = 'fail';
    log.error(`${trace} ├─[落库] 失败! error=${e.message}`);
  }

  // --- 完成总结 ---
  const total = Date.now() - t0;
  log.info(`${trace} └── 审核完成 总耗时=${total}ms ──────────────`);
  log.info(`${trace}    provider=${usedExternal ? `${externalConfig.provider}(外部)` : 'builtin(内置)'}  externalError=${externalError ? 'YES' : 'NO'}`);
  log.info(`${trace}    verdict=${finalVerdict}  label=${result.riskLabel}  score=${result.riskScore}  blocked=${isBlocked}  logId=${logId}`);
  if (finalVerdict === 'violation') {
    log.warn(`${trace}    ⚠️ 内容违规，已拦截。如需放行请通过 /api/v1/ai/moderation/logs/${logId}/review 人工复审。`);
  }

  return {
    verdict: finalVerdict,
    riskLabel: result.riskLabel,
    riskScore: result.riskScore,
    confidence: result.confidence,
    isBlocked,
    logId,
    details: result.details || [],
    provider: externalConfig ? externalConfig.provider : 'builtin',
    _diagnostics: {
      trace: trace.replace(/[\[\]]/g, ''),
      totalMs: total,
      usedExternal,
      externalError: externalError ? externalError.message : null,
      mode,
      rule: { threshold: rule.threshold, action: rule.action },
      dbStatus,
    },
  };
}

// ---------- 审核记录查询 ----------

function listLogs(db, params = {}) {
  const w = []; const p = [];
  if (params.userId) { w.push('user_id = ?'); p.push(params.userId); }
  if (params.dramaId) { w.push('drama_id = ?'); p.push(params.dramaId); }
  if (params.verdict) { w.push('verdict = ?'); p.push(params.verdict); }
  if (params.resourceType) { w.push('resource_type = ?'); p.push(params.resourceType); }
  const limit = Math.min(100, Number(params.limit) || 50);
  const offset = Number(params.offset) || 0;
  const sql = `SELECT * FROM content_moderation_logs ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  const rows = p.length ? db.prepare(sql).all(...p) : db.prepare(sql).all();
  return rows.map(r => ({
    id: r.id, userId: r.user_id, dramaId: r.drama_id,
    resourceType: r.resource_type, resourceId: r.resource_id, resourceUrl: r.resource_url,
    provider: r.provider, verdict: r.verdict, riskLabel: r.risk_label,
    riskScore: Number(r.risk_score), confidence: Number(r.confidence),
    mode: r.mode, isBlocked: !!r.is_blocked, createdAt: r.created_at,
  }));
}

function getLog(db, id) {
  const row = db.prepare('SELECT * FROM content_moderation_logs WHERE id = ?').get(id);
  if (!row) return null;
  let detail = null;
  try { detail = JSON.parse(row.detail_json); } catch (_) {}
  return {
    id: row.id, userId: row.user_id, dramaId: row.drama_id,
    resourceType: row.resource_type, resourceId: row.resource_id, resourceUrl: row.resource_url,
    contentSnapshot: row.content_snapshot, provider: row.provider, verdict: row.verdict,
    riskLabel: row.risk_label, riskScore: Number(row.risk_score), confidence: Number(row.confidence),
    detail, mode: row.mode, isBlocked: !!row.is_blocked,
    reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, reviewNote: row.review_note,
    createdAt: row.created_at,
  };
}

/**
 * 人工复审：更新审核结论
 */
function review(db, log, id, params) {
  log = log || console;
  const { verdict, reviewNote, reviewedBy } = params;
  if (!['safe', 'pending', 'violation'].includes(verdict)) throw new Error('verdict 必须为 safe/pending/violation');
  const now = nowStr();
  const isBlocked = verdict === 'violation' ? 1 : 0;
  db.prepare(`UPDATE content_moderation_logs SET verdict = ?, is_blocked = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?`)
    .run(verdict, isBlocked, reviewedBy || null, now, reviewNote || null, now, id);
  log.info('[MODERATION] 人工复审', { id, verdict, reviewedBy });
  return { id, verdict, isBlocked: !!isBlocked, reviewedAt: now };
}

/**
 * 批量审核：对多个资源批量审核
 */
async function moderateBatch(db, log, items, mode = 'standard') {
  const results = [];
  for (const item of items) {
    try {
      const r = await moderate(db, log, { ...item, mode });
      results.push({ ...r, resourceType: item.resourceType, resourceId: item.resourceId });
    } catch (err) {
      results.push({ resourceType: item.resourceType, resourceId: item.resourceId, verdict: 'pending', error: err.message });
    }
  }
  return { total: items.length, results };
}

module.exports = {
  moderate,
  moderateBatch,
  listLogs,
  getLog,
  review,
  getRules,
  // 暴露内置审核函数供测试
  moderateTextBuiltin,
  moderateImageBuiltin,
};
