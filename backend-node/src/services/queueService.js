'use strict';
/**
 * queueService.js
 * Sprint 1 - 基础设施：Redis + Bull 任务队列
 * 功能：
 *  1) 连接 Redis，创建/管理 Bull Queue 实例
 *  2) 定义编剧队列的五种任务类型：outline / characters / episodes / storyboard / dialogue / tts
 *  3) 提供 createJob / getJobStatus / cancelJob 接口
 *  4) 如果 Redis 不可用，自动降级到本地内存队列（保证开发模式可用）
 */

const Bull = require('bull');
const EventEmitter = require('events');
const { loadConfig } = require('../config/index.js');

let config = null;
function getConfig() {
  if (!config) config = loadConfig();
  return config;
}

const QUEUE_NAME = 'screenwriter_queue';
const VALID_JOB_TYPES = ['outline', 'characters', 'episodes', 'storyboard', 'dialogue', 'tts'];

/** 内存队列降级（当Redis不可用时）*/
class MemoryQueue extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.nextId = 1;
    this.handler = null;
    this.interval = null;
  }
  setMaxListeners() { /* noop */ }
  process(handler) {
    this.handler = handler;
    // 模拟消费循环
    this.interval = setInterval(() => this._tick(), 50);
  }
  async _tick() {
    if (!this.handler) return;
    for (const [id, job] of this.jobs) {
      if (job.status !== 'pending') continue;
      job.status = 'processing';
      this.emit('active', job);
      try {
        const res = await this.handler(job, (progress) => {
          job.progress = progress;
          this.emit('progress', job, progress);
        });
        job.status = 'completed';
        job.returnvalue = res;
        job.completedAt = Date.now();
        this.emit('completed', job, res);
      } catch (err) {
        job.status = 'failed';
        job.failedReason = err.message || String(err);
        job.stackFailedReason = err.stack;
        this.emit('failed', job, err);
      }
    }
  }
  async add(name, data, opts) {
    const id = String(this.nextId++);
    const job = {
      id,
      name,
      data,
      opts: opts || {},
      status: 'pending',
      progress: 0,
      attemptsMade: 0,
      addedAt: Date.now(),
    };
    this.jobs.set(id, job);
    this.emit('waiting', job);
    return {
      id,
      name,
      data,
      async getState() { return job.status; },
      async progress() { return job.progress; },
      async toJSON() { return job; },
    };
  }
  async getJob(id) {
    const j = this.jobs.get(String(id));
    if (!j) return null;
    return {
      id: j.id,
      name: j.name,
      data: j.data,
      returnvalue: j.returnvalue,
      failedReason: j.failedReason,
      stacktrace: j.stackFailedReason ? [j.stackFailedReason] : [],
      attemptsMade: j.attemptsMade,
      async getState() { return j.status; },
      async progress() { return j.progress; },
      async toJSON() { return j; },
    };
  }
  onCompleted(cb) { this.on('completed', (job, res) => cb({ id: job.id, name: job.name, data: job.data }, res)); }
  onFailed(cb) { this.on('failed', (job, err) => cb({ id: job.id, name: job.name, data: job.data, failedReason: job.failedReason }, err)); }
  onProgress(cb) { this.on('progress', (job, p) => cb({ id: job.id, name: job.name, data: job.data }, p)); }
  onActive(cb) { this.on('active', (job) => cb({ id: job.id, name: job.name, data: job.data })); }
  async close() { if (this.interval) clearInterval(this.interval); this.removeAllListeners(); }
  async disconnect() { return this.close(); }
}

let _queue = null;
let _redisOk = false;
let _fallback = false;

function getRedisOptions() {
  const c = getConfig();
  const r = (c && c.redis) || {};
  // 注意：Bull 4.x 不允许在 Redis 选项中使用 enableReadyCheck 或 maxRetriesPerRequest
  // 这些选项与 Bull 内部 subscriber / bclient 的连接策略冲突。
  // 参见 https://github.com/OptimalBits/bull/issues/1873
  const opts = {
    host: r.host || '127.0.0.1',
    port: Number(r.port || 6379),
  };
  if (r.password) opts.password = r.password;
  if (r.db != null) opts.db = Number(r.db);
  return opts;
}

function getQueueOpts() {
  const c = getConfig();
  const q = (c && c.queue) || {};
  return {
    attempts: Number(q.default_attempts || 3),
    backoff: {
      type: q.backoff_type || 'exponential',
      delay: Number(q.backoff_delay || 5000),
    },
    removeOnComplete: q.removeOnComplete ?? 1000,
    removeOnFail: q.removeOnFail ?? 500,
  };
}

function getConcurrency() {
  const c = getConfig();
  return Number(((c && c.queue) || {}).concurrency || 2);
}

function queueEnabled() {
  const c = getConfig();
  return ((c && c.queue) || {}).enabled !== false;
}

async function createQueue() {
  if (_queue) return { queue: _queue, redisOk: _redisOk, fallback: _fallback };

  if (!queueEnabled()) {
    console.log('[Queue] queue.enabled=false, using MemoryQueue');
    _queue = new MemoryQueue();
    _fallback = true;
    _redisOk = false;
    return { queue: _queue, redisOk: false, fallback: true };
  }

  try {
    const redisOpts = getRedisOptions();
    const bullQueue = new Bull(QUEUE_NAME, { redis: redisOpts });
    bullQueue.setMaxListeners(200);
    // 连接事件
    bullQueue.on('error', (err) => {
      console.warn('[Queue] Bull error:', err.message || err);
    });
    bullQueue.on('failed', (job, err) => {
      console.error(`[Queue] job failed: ${job?.name}/${job?.id}`, err?.message || err);
    });
    // 通过一个ping动作验证连接
    try {
      await bullQueue.client.ping();
      _redisOk = true;
    } catch (pingErr) {
      console.warn('[Queue] Redis ping failed, fallback to MemoryQueue:', pingErr.message);
      try { await bullQueue.close(); } catch (_) {}
      _queue = new MemoryQueue();
      _fallback = true;
      _redisOk = false;
      return { queue: _queue, redisOk: false, fallback: true };
    }
    _queue = bullQueue;
    _fallback = false;
    _redisOk = true;
    console.log('[Queue] Bull ready (Redis OK)');
    return { queue: _queue, redisOk: true, fallback: false };
  } catch (err) {
    console.warn('[Queue] Failed to init Bull, fallback to MemoryQueue:', err.message);
    _queue = new MemoryQueue();
    _fallback = true;
    _redisOk = false;
    return { queue: _queue, redisOk: false, fallback: true };
  }
}

async function ensureQueue() {
  if (!_queue) await createQueue();
  return _queue;
}

function validateJobType(type) {
  if (!VALID_JOB_TYPES.includes(type)) {
    throw new Error(`Invalid job_type: ${type}. Must be one of: ${VALID_JOB_TYPES.join(',')}`);
  }
}

async function createJob({ jobType, payload, customJobId, options }) {
  validateJobType(jobType);
  const queue = await ensureQueue();
  const defaultOpts = getQueueOpts();
  const jobName = jobType;
  const finalOpts = {
    ...defaultOpts,
    ...(options || {}),
  };
  if (customJobId) finalOpts.jobId = String(customJobId);
  const job = await queue.add(jobName, { jobType, payload, createdAt: Date.now() }, finalOpts);
  return {
    jobId: String(job.id),
    jobType,
    name: job.name,
  };
}

async function getJobStatus(jobId) {
  const queue = await ensureQueue();
  const job = await queue.getJob(String(jobId));
  if (!job) return { jobId, exists: false };
  const state = await job.getState();
  const progress = await job.progress();
  const failedReason = job.failedReason || null;
  const result = job.returnvalue || null;
  return {
    jobId: String(job.id),
    name: job.name,
    data: job.data || null,
    state,
    progress,
    failedReason,
    result,
    attemptsMade: job.attemptsMade || 0,
    stacktrace: job.stacktrace || [],
  };
}

async function cancelJob(jobId) {
  const queue = await ensureQueue();
  const job = await queue.getJob(String(jobId));
  if (!job) return { jobId, exists: false, cancelled: false };
  const state = await job.getState();
  if (state === 'completed' || state === 'failed') {
    return { jobId, exists: true, cancelled: false, reason: `already ${state}` };
  }
  if (job.discard) await job.discard();
  if (job.remove) await job.remove().catch(() => {});
  return { jobId, exists: true, cancelled: true };
}

/** 注册消费者（worker端） */
async function registerWorker(handlerMap) {
  const queue = await ensureQueue();
  const concurrency = getConcurrency();
  // 为每个jobType（即Bull job name）分别注册处理器
  // 因为 queue.add(name, data) 投递的任务只会由 queue.process(name, fn) 消费
  const keys = Object.keys(handlerMap || {});
  for (const jobType of keys) {
    const handler = handlerMap[jobType];
    queue.process(jobType, concurrency, async (job, onProgress) => {
      validateJobType(jobType);
      // onProgress 兼容：参数 (progress, payload?)
      const report = (p, extra) => {
        if (typeof onProgress === 'function') {
          try { onProgress(p, extra); } catch (_) {}
        }
      };
      return await handler(job, report);
    });
  }
  return { concurrency };
}

/** 监听事件（写入sw_jobs等） */
function onEvent(evtName, cb) {
  ensureQueue().then((q) => {
    if (typeof q[evtName] === 'function') {
      q[evtName](cb);
    } else if (q.on) {
      q.on(evtName, cb);
    }
  });
}

async function closeQueue() {
  if (_queue && typeof _queue.close === 'function') {
    await _queue.close().catch(() => {});
    await _queue.disconnect && _queue.disconnect().catch(() => {});
  }
  _queue = null;
  _redisOk = false;
  _fallback = false;
}

module.exports = {
  QUEUE_NAME,
  VALID_JOB_TYPES,
  createQueue,
  ensureQueue,
  createJob,
  getJobStatus,
  cancelJob,
  registerWorker,
  onEvent,
  closeQueue,
  getQueueOpts,
  getConcurrency,
  isFallback: () => _fallback,
  isRedisOk: () => _redisOk,
};
