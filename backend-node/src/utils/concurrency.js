'use strict';

/**
 * concurrency.js — 并发控制工具集（无外部依赖，纯Node实现）
 *
 *  1) Singleflight: 合并同key的并发请求，防止缓存击穿
 *     用法：
 *        const sf = new Singleflight();
 *        const result = await sf.do('mykey', async () => await fetchFromDb());
 *     效果：N个并发同时调用同一个未完成的mykey，只会实际执行1次fetchFromDb，
 *           其余N-1个await等待同一个Promise返回，全部拿到相同结果。
 *
 *  2) SimpleBloomFilter: 轻量内存布隆过滤器（k个hash函数 + bitset），
 *     用于拦截"一定不存在"的id请求，防止缓存穿透。
 *     假阳率：当n < capacity*0.8时≈0.5%。误判（true实际不存在）可接受，
 *     因为只是放过请求继续走正常缓存+DB链路；false（实际存在）绝对不会误判。
 *
 *  3) ObjectIdGuard: 深拷贝/递归遍历时的循环引用检测，防栈溢出。
 */

/* ============================================================
 *  Singleflight（缓存击穿防护）
 * ============================================================ */
class Singleflight {
  constructor() {
    /** @type {Map<string, {promise: Promise<any>, resolve: Function, reject: Function, waiters: number}>} */
    this.inflight = new Map();
  }

  /**
   * 执行或加入同key的正在进行的任务
   * @param {string} key 唯一标识（如缓存key）
   * @param {() => Promise<any>} fn 实际任务（如DB查询）
   * @returns {Promise<any>} 任务结果
   */
  async do(key, fn) {
    const existing = this.inflight.get(key);
    if (existing) {
      existing.waiters += 1;
      return existing.promise;
    }

    // 创建新的 inflight entry —— 注意用resolve/reject钩子，
    // 这样既能捕获fn的异常，也能保证所有等待者拿到同一个结果或错误
    let resolveOuter, rejectOuter;
    const promise = new Promise((res, rej) => {
      resolveOuter = res;
      rejectOuter = rej;
    });

    const entry = { promise, resolve: resolveOuter, reject: rejectOuter, waiters: 0 };
    this.inflight.set(key, entry);

    try {
      const result = await fn();
      resolveOuter(result);
      return result;
    } catch (err) {
      rejectOuter(err);
      throw err;
    } finally {
      // 无论成功失败，必须清理inflight entry（否则后续请求会挂到已Settled的Promise上）
      this.inflight.delete(key);
    }
  }

  /** 仅用于测试 */
  get inflightCount() {
    return this.inflight.size;
  }
}

/* ============================================================
 *  SimpleBloomFilter（缓存穿透防护 —— 拦截"一定不存在"的id）
 * ============================================================ */
class SimpleBloomFilter {
  /**
   * @param {number} capacity 预期存储元素数量（默认 100_000）
   * @param {number} falsePositiveRate 可接受的假阳率（默认0.005 = 0.5%）
   */
  constructor(capacity = 100000, falsePositiveRate = 0.005) {
    // m = -n*ln(p) / (ln2)^2
    const ln2 = Math.LN2;
    const mBit = Math.ceil((-capacity * Math.log(falsePositiveRate)) / (ln2 * ln2));
    // k = (m/n) * ln2
    const kHash = Math.max(1, Math.round((mBit / capacity) * ln2));

    this.size = mBit;
    this.k = kHash;
    this.count = 0;
    this.capacity = capacity;
    // 用 Uint32Array 以32位为块存储bits，比数组省内存
    this.buckets = new Uint32Array(Math.ceil(mBit / 32));
  }

  /**
   * FNV-1a 32位哈希 —— 不需要crypto依赖，极快
   */
  _fnv1a(str, seed = 0x811c9dc5) {
    let h = seed ^ 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193); // FNV prime 32-bit
    }
    return h >>> 0;
  }

  /**
   * k个独立哈希：用FNV1a + 不同seed（Kirsch-Mitzenmacher优化：两个基础hash线性组合）
   */
  * _positions(item) {
    const s = String(item);
    const h1 = this._fnv1a(s, 0x811c9dc5);
    const h2 = this._fnv1a(s, 0xdeadbeef);
    for (let i = 0; i < this.k; i++) {
      const combined = (h1 + Math.imul(i, h2)) >>> 0;
      yield combined % this.size;
    }
  }

  add(item) {
    for (const pos of this._positions(item)) {
      const bucketIdx = pos >>> 5; // pos / 32
      const bitIdx = pos & 31;    // pos % 32
      this.buckets[bucketIdx] |= (1 << bitIdx);
    }
    this.count += 1;
  }

  /**
   * @returns {boolean} false = 一定不存在；true = 可能存在（假阳率p）
   */
  mightContain(item) {
    for (const pos of this._positions(item)) {
      const bucketIdx = pos >>> 5;
      const bitIdx = pos & 31;
      if ((this.buckets[bucketIdx] & (1 << bitIdx)) === 0) {
        return false;
      }
    }
    return true;
  }

  get fillRate() {
    let setBits = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      let v = this.buckets[i];
      while (v) { v &= v - 1; setBits++; }
    }
    return (setBits / this.size).toFixed(4);
  }
}

/* ============================================================
 *  AsyncQueue —— 通用本地并发限流队列（FIFO Semaphore）
 *  用于替换无界 setImmediate，防止异步任务打满 DB 连接池 / CPU / ffmpeg 子进程。
 *  BgmAsyncQueue / MergeAsyncQueue 均基于此实现，保证限流语义一致。
 * ============================================================ */
class AsyncQueue {
  /**
   * @param {number} concurrency 允许的最大并发数（>=1）
   * @param {string} [name] 队列名（仅用于日志标识）
   */
  constructor(concurrency, name = 'async-queue') {
    const c = Number(concurrency);
    this.concurrency = (Number.isFinite(c) && c >= 1) ? Math.floor(c) : 2;
    this.name = name;
    this._running = 0;
    this._queue = []; // Array<{fn, resolve, reject, enqueuedAt}>
    this._submitted = 0;
    this._completed = 0;
  }

  _runNext() {
    while (this._running < this.concurrency && this._queue.length > 0) {
      const task = this._queue.shift();
      this._running++;
      const waitMs = Date.now() - task.enqueuedAt;
      Promise.resolve()
        .then(() => task.fn())
        .then((r) => task.resolve(r))
        .catch((e) => task.reject(e))
        .finally(() => {
          this._running--;
          this._completed++;
          Promise.resolve().then(() => this._runNext());
        });
      // 入队即打印一次排队等待时长（便于排查积压）
      if (waitMs > 5) {
        console.log(`[ASYNC-Q:${this.name}] 任务出队执行  waited=${waitMs}ms  running=${this._running}/${this.concurrency}  queued=${this._queue.length}`);
      }
    }
  }

  /**
   * @param {() => Promise<any>} fn 实际任务
   * @returns {Promise<any>} 任务结果
   */
  add(fn) {
    this._submitted++;
    return new Promise((resolve, reject) => {
      this._queue.push({ fn, resolve, reject, enqueuedAt: Date.now() });
      Promise.resolve().then(() => this._runNext());
    });
  }

  get stats() {
    return {
      name: this.name,
      concurrency: this.concurrency,
      running: this._running,
      queued: this._queue.length,
      submitted: this._submitted,
      completed: this._completed,
    };
  }

  /** 仅用于测试，等待全部清空 */
  _drain() {
    const check = () => new Promise(res => {
      if (this._running === 0 && this._queue.length === 0) return res();
      setTimeout(() => check().then(res), 20);
    });
    return check();
  }
}

/* ============================================================
 *  ObjectIdGuard —— 递归遍历的循环引用检测
 * ============================================================ */
class ObjectIdGuard {
  constructor() {
    this.visited = new WeakSet();
  }
  /** 若已访问过返回true（应跳过）；否则标记并返回false */
  checkAndMark(obj) {
    if (obj === null || typeof obj !== 'object') return false;
    if (this.visited.has(obj)) return true;
    this.visited.add(obj);
    return false;
  }
}

module.exports = {
  Singleflight,
  SimpleBloomFilter,
  AsyncQueue,
  ObjectIdGuard,
};
