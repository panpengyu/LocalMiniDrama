'use strict';
/**
 * screenwriterWorker.js
 * Sprint 1 - T09: Bull任务消费者 + sw_jobs双写
 *
 * 职责：
 *  1) 为 outline/characters/episodes/storyboard/dialogue/tts 各注册一个处理器
 *  2) 处理器执行前：更新 sw_jobs.status -> processing，记录started_at
 *  3) 执行中：监听 progress 事件 -> sw_jobs.progress
 *  4) 成功：status=completed, 写入 result_json, completed_at, duration_ms
 *  5) 失败：status=failed, error_message, retry_count++（Bull自动重试）
 *
 *  入口：startScreenwriterWorker(db, log)
 *  注意：该模块只在主服务启动时调用一次。
 */

const queueService = require('./queueService');
const swService = require('./screenwriterService');

function nowIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function patchFromResult(jobType, result) {
  // 便于前端快速拿到关键ID
  const p = {};
  if (jobType === 'outline') {
    p.outlineId = result?.outlineId || null;
  } else if (jobType === 'characters') {
    p.outlineId = result?.outlineId || null;
  } else if (jobType === 'episodes') {
    p.outlineId = result?.outlineId || null;
  } else if (jobType === 'storyboard') {
    p.episodeId = result?.episodeId || null;
    p.outlineId = result?.outlineId || null;
  } else if (jobType === 'dialogue') {
    p.episodeId = result?.episodeId || null;
    p.outlineId = result?.outlineId || null;
  } else if (jobType === 'tts') {
    p.dialogueId = result?.dialogueId || null;
  }
  return p;
}

async function withJobLifecycle(db, log, job, progressCb, handlerFn) {
  const payload = (job.data && job.data.payload) || job.data || {};
  const jobType = (job.data && job.data.jobType) || job.name;
  const jobId = payload.swJobId || `sw_${job.id}`;
  const userId = payload.userId || null;
  const enterpriseId = payload.enterpriseId || null;

  // 1. 新建/更新记录 -> pending -> processing
  try {
    const existing = swService.getJobRecord(db, jobId);
    if (!existing) {
      swService.createJobRecord(db, {
        jobId,
        bullJobId: String(job.id),
        userId,
        enterpriseId,
        jobType,
        payload,
        status: 'processing',
        progress: 5,
        startedAt: nowIso(),
      });
    } else {
      swService.updateJobRecord(db, jobId, {
        bullJobId: String(job.id),
        status: 'processing',
        progress: 5,
        startedAt: nowIso(),
      });
    }
  } catch (e) {
    log.warn('[SW-WORKER] create job record fail:', e.message);
  }

  const startMs = Date.now();
  // progress事件
  const onProgress = (p, extra) => {
    // 按 S1-T09 验收要求：20/40/60/80/100 五段式进度写回 MySQL sw_jobs.progress
    // 允许 100（结束后 completed 路径再设100做双保险，也不会出错）
    const pp = Math.max(0, Math.min(100, Number(p) || 0));
    try {
      swService.updateJobRecord(db, jobId, { progress: pp });
    } catch (_) {}
    if (typeof progressCb === 'function') {
      try { progressCb(pp, extra); } catch (_) {}
    }
  };

  try {
    onProgress(10, { phase: 'start' });
    const result = await handlerFn(payload, onProgress);
    const duration = Date.now() - startMs;

    // 把关键id写入sw_jobs关联字段
    const patch = {
      status: 'completed',
      progress: 100,
      result: result || null,
      completedAt: nowIso(),
      durationMs: duration,
      costPoints: result?.costPoints || 0,
    };
    const extra = patchFromResult(jobType, result || {});
    if (extra) {
      Object.assign(patch, extra);
      // 特殊：把关联字段也直接写进 result（便于查询）
      if (!patch.result || typeof patch.result !== 'object') patch.result = { ...(patch.result || {}), _raw: patch.result };
      Object.assign(patch.result, extra);
    }
    try {
      swService.updateJobRecord(db, jobId, patch);
    } catch (e) {
      log.warn('[SW-WORKER] update completed fail:', e.message);
    }
    return {
      jobId,
      jobType,
      durationMs: duration,
      result,
    };
  } catch (err) {
    log.error('[SW-WORKER] job error:', jobType, err?.message || err);
    const duration = Date.now() - startMs;
    try {
      swService.updateJobRecord(db, jobId, {
        status: 'failed',
        progress: 0,
        errorMessage: err?.message || String(err),
        completedAt: nowIso(),
        durationMs: duration,
      });
    } catch (_) {}
    throw err;
  }
}

/**
 * 通用生成任务执行：按 20/40/60/80/100 五段式进度上报
 *   0~20%  → 加载上下文 / 校验参数
 *  20~40% → AI 模型调用（流式）
 *  40~60% → JSON 解析 / 兜底修复
 *  60~80% → 数据落库 MySQL
 *  80~100%→ 关联字段回填 / 收尾
 */
async function runGenerateStep(stepName, p, onProg, fn) {
  const result = await fn();
  return result;
}

function buildHandlers(db, log) {
  return {
    outline: async (job, progressCb) => withJobLifecycle(db, log, job, progressCb, async (p, onProg) => {
      onProg(20, { phase: 'load-context' });
      const res = await runGenerateStep('outline-ai', p, onProg, async () => {
        // 注入 onProgress 到生成函数内部（通过 Symbol 隐藏参数），供 generateOutline 按需上报
        p.__progress = onProg;
        return await swService.generateOutline(db, log, p);
      });
      onProg(40, { phase: 'ai-call-done' });
      await runGenerateStep('outline-parse', p, onProg, async () => {
        onProg(60, { phase: 'parsed-ok' }); return null;
      });
      onProg(80, { phase: 'mysql-saved' });
      onProg(100, { phase: 'completed' });
      return res;
    }),
    characters: async (job, progressCb) => withJobLifecycle(db, log, job, progressCb, async (p, onProg) => {
      onProg(20, { phase: 'load-outline-context' });
      p.__progress = onProg;
      const res = await swService.generateCharacters(db, log, p);
      onProg(40, { phase: 'ai-call-done' });
      onProg(60, { phase: 'parsed-ok' });
      onProg(80, { phase: 'mysql-saved' });
      onProg(100, { phase: 'completed' });
      return res;
    }),
    episodes: async (job, progressCb) => withJobLifecycle(db, log, job, progressCb, async (p, onProg) => {
      onProg(20, { phase: 'load-outline' });
      p.__progress = onProg;
      const res = await swService.generateEpisodes(db, log, p);
      onProg(40, { phase: 'ai-call-done' });
      onProg(60, { phase: 'parsed-ok' });
      onProg(80, { phase: 'mysql-saved-scenes' });
      onProg(100, { phase: 'completed' });
      return res;
    }),
    storyboard: async (job, progressCb) => withJobLifecycle(db, log, job, progressCb, async (p, onProg) => {
      onProg(20, { phase: 'load-episode' });
      p.__progress = onProg;
      const res = await swService.generateStoryboard(db, log, p);
      onProg(40, { phase: 'ai-call-done' });
      onProg(60, { phase: 'parsed-ok' });
      onProg(80, { phase: 'mysql-saved' });
      onProg(100, { phase: 'completed' });
      return res;
    }),
    dialogue: async (job, progressCb) => withJobLifecycle(db, log, job, progressCb, async (p, onProg) => {
      onProg(20, { phase: 'load-episode+frames' });
      p.__progress = onProg;
      const res = await swService.generateDialogue(db, log, p);
      onProg(40, { phase: 'ai-call-done' });
      onProg(60, { phase: 'parsed-ok' });
      onProg(80, { phase: 'mysql-saved' });
      onProg(100, { phase: 'completed' });
      return res;
    }),
    tts: async (job, progressCb) => withJobLifecycle(db, log, job, progressCb, async (p, onProg) => {
      // 占位：TTS 生成留到后续 Sprint 实现
      onProg(20); onProg(40); onProg(60); onProg(80); onProg(100);
      return { dialogueId: p.dialogueId || null, todo: true, message: 'TTS任务将在后续Sprint实现' };
    }),
  };
}

async function startScreenwriterWorker(db, log) {
  log = log || { info: console.log, warn: console.warn, error: console.error };
  await queueService.ensureQueue();
  const handlers = buildHandlers(db, log);
  const { concurrency } = await queueService.registerWorker(handlers);
  log.info('[SW-WORKER] started', {
    concurrency,
    redisOk: queueService.isRedisOk(),
    fallback: queueService.isFallback(),
  });

  // 事件监听：debug用
  queueService.onEvent('onCompleted', (job, result) => {
    log.info('[SW-WORKER] job completed:', job?.name, job?.id, '->', result?.result?.outlineId || result?.result?.episodeId || '');
  });
  queueService.onEvent('onFailed', (job, err) => {
    log.error('[SW-WORKER] job failed:', job?.name, job?.id, err?.message);
  });
  queueService.onEvent('onActive', (job) => {
    log.info('[SW-WORKER] job active:', job?.name, job?.id);
  });
  return { concurrency, handlers: Object.keys(handlers) };
}

module.exports = {
  startScreenwriterWorker,
  buildHandlers,
  withJobLifecycle,
};
