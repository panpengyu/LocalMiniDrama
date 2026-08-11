'use strict';

/**
 * s8CacheFixes.test.js
 * Sprint 8 - P0/P1 风险修复 专项单元测试
 *
 * 覆盖范围：
 *   R1: MemoryLRU 竞态（同key重复set不泄漏TTL定时器 + 容量原子不超）
 *   R2: Singleflight 并发合并（N并发同key只执行1次DB查询）
 *   R3: 缓存穿透防护（NaN id快速失败 / Bloom拦截"一定不存在" / success=false短TTL缓存）
 *   R5: LRU容量配置化 + getStats cluster_warning反馈
 *   R8: 4xx/5xx 不缓存
 *   R9: 长query串sha256摘要防key过长
 *   R6: BGM限流队列 并发上限=4
 *
 * 使用 node --test test/s8CacheFixes.test.js 运行。
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const cacheService = require('../src/services/cacheService.js');
const bgmService = require('../src/services/bgmService.js');
const {
  Singleflight,
  SimpleBloomFilter,
  ObjectIdGuard,
} = require('../src/utils/concurrency.js');

/* =========================================================================
 *  R1 — LRU TTL定时器不泄漏 / 容量原子不超
 * ========================================================================= */
describe('P0-R1: MemoryLRU 竞态修复 (TTL不泄漏 + 容量原子)', () => {
  // 测试中要实例化小容量LRU，用已导出的_memoryCache.constructor（即MemoryLRU类）
  const CacheClass = cacheService._memoryCache.constructor;
  // 注意：构造器要求 maxSize>10 才会采用传入值，否则退回默认10000（见构造器R5防御）
  const MIN_CAP = 20;

  test('R1a: 同key重复set → 旧timer被清，最后写入的值在完整TTL后才过期', async () => {
    const cache = cacheService._memoryCache;
    cache.clear();

    let timerCountBefore = cache._timerMap.size;
    assert.strictEqual(timerCountBefore, 0, '初始timerMap应为空');

    // 长TTL旧值 覆盖为 短TTL新值
    cache.set('r1:dup', 'v1', 500);
    cache.set('r1:dup', 'v2', 15);

    assert.strictEqual(cache._timerMap.size, 1,
      '同key重复set后，timerMap size必须仍是1，不能有2个定时器（否则旧定时器会提前删新值）');
    assert.strictEqual(cache.get('r1:dup'), 'v2');

    // 等待 30ms（15ms已过期）
    await new Promise(r => setTimeout(r, 30));

    assert.strictEqual(cache.get('r1:dup'), null,
      '15ms TTL 到了后应已过期；如果残留v1的长TTL → 还能读到值=bug');
    assert.strictEqual(cache._timerMap.size, 0, '过期后timerMap应清0');
  });

  test('R1b: LRU maxSize 边界正确，永远不超过 capacity', () => {
    const small = new CacheClass(MIN_CAP);
    assert.strictEqual(small.maxSize, MIN_CAP);

    for (let i = 0; i < 100; i++) {
      small.set(`k${i}`, `v${i}`);
      assert.ok(
        small.cache.size <= small.maxSize,
        `插入${i+1}次后 size=${small.cache.size} > capacity=${small.maxSize} → 原子淘汰边界被打破`
      );
    }
    assert.strictEqual(small.cache.size, small.maxSize, '插入100次后，最终size必须正好等于maxSize');
    // LRU 最旧 (100-MIN_CAP)=80个(k0..k79)应已被淘汰，最新20个k80..k99存在
    for (let i = 100 - MIN_CAP; i < 100; i++) {
      assert.strictEqual(small.get(`k${i}`), `v${i}`, `k${i} 应为存活`);
    }
  });

  test('R1c: 删除key时同步清理timer（内存泄漏防护）', () => {
    const lru = new CacheClass(MIN_CAP);
    lru.set('foo', 'bar', 60000);
    assert.strictEqual(lru._timerMap.size, 1);
    lru.del('foo');
    assert.strictEqual(lru._timerMap.size, 0, 'del必须同步删除定时器');
    lru.set('a', 1, 60000);
    lru.set('b', 2, 60000);
    lru.clear();
    assert.strictEqual(lru._timerMap.size, 0, 'clear必须清光所有定时器');
  });
});

/* =========================================================================
 *  R2 — Singleflight: N并发同key，只执行一次实际计算
 * ========================================================================= */
describe('P0-R2: Singleflight 防击穿（合并并发请求）', () => {
  test('R2a: 100并发同key → 实际fn只调用1次', async () => {
    const sf = new Singleflight();
    let callCount = 0;
    const slowFn = () => new Promise(resolve => {
      callCount++;
      // 模拟 50ms DB 查询
      setTimeout(() => resolve(`result-${callCount}`), 50);
    });

    const N = 100;
    const promises = [];
    for (let i = 0; i < N; i++) {
      promises.push(sf.do('same-key', slowFn));
    }
    const results = await Promise.all(promises);

    assert.strictEqual(callCount, 1,
      `100并发同key，实际慢函数只应调用1次，实际调用${callCount}次`);

    // 所有100个请求拿到的结果必须相同
    for (const r of results) {
      assert.strictEqual(r, 'result-1');
    }
    assert.strictEqual(sf.inflightCount, 0, '完成后inflight应清空');
  });

  test('R2b: 不同key → 各自独立执行，100个key=100次调用', async () => {
    const sf = new Singleflight();
    let callCount = 0;
    const fn = (k) => () => new Promise(res => {
      callCount++;
      setTimeout(() => res(`r-${k}`), 5);
    });
    const N = 50;
    const p = [];
    for (let i = 0; i < N; i++) p.push(sf.do(`k${i}`, fn(`k${i}`)));
    await Promise.all(p);
    assert.strictEqual(callCount, N, `不同key不应合并，各执行1次`);
  });

  test('R2c: inflight任务抛错 → 所有waiter都收到同一个错误', async () => {
    const sf = new Singleflight();
    let callCount = 0;
    const err = new Error('DB down');
    const badFn = () => new Promise((res, rej) => {
      callCount++;
      setTimeout(() => rej(err), 20);
    });
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () => sf.do('err-key', badFn))
    );
    assert.strictEqual(callCount, 1);
    for (const r of results) {
      assert.strictEqual(r.status, 'rejected');
      assert.strictEqual(r.reason, err);
    }
  });
});

/* =========================================================================
 *  R3 — 缓存穿透 三层防护
 * ========================================================================= */
describe('P0-R3: 缓存穿透防护 (NaN拦截 / Bloom / 空值短TTL缓存)', () => {
  test('R3a: 布隆过滤器 Basic —— 加入的元素必定返回true；未加入大概率false', () => {
    const bloom = new SimpleBloomFilter(10000, 0.005);
    for (let i = 1; i <= 1000; i++) bloom.add(i);
    for (let i = 1; i <= 1000; i++) {
      assert.ok(bloom.mightContain(i), `已经add的id=${i} must be true`);
    }
    // 不存在的id：10万条随机检测，假阳率应极低
    let fp = 0;
    const trials = 10000;
    for (let i = 2001; i < 2001 + trials; i++) {
      if (bloom.mightContain(i)) fp++;
    }
    // 0.5%假阳率，10000次理应最多80次误判（3σ留余量）
    assert.ok(fp < 120,
      `Bloom假阳率过高：${fp}/${trials} = ${(fp/trials*100).toFixed(2)}%，应≈0.5%`);
  });

  test('R3b: cacheMiddleware — 非整数 dramaId 直接 400 BAD_ID，不进入next()', async () => {
    cacheService._memoryCache.clear();
    const mid = cacheService.cacheMiddleware('dramas', 300);
    let nextCalled = 0;
    // params.id = 'abc' → 非正整数
    const fakeReq = {
      method: 'GET',
      path: '/api/v1/dramas/abc',
      params: { id: 'abc' },
      query: {},
      user: { id: 1 },
    };
    let statusSet = null;
    let bodySent = null;
    const fakeRes = {
      statusCode: 200,
      status(s) { this.statusCode = statusSet = s; return this; },
      json(b) { bodySent = b; return this; },
    };
    // mid 是 async 函数：即使它内部不调next，await也能正确结束
    await mid(fakeReq, fakeRes, () => { nextCalled++; });
    assert.strictEqual(nextCalled, 0, '非整数id → 不应调用next()进入业务handler');
    assert.strictEqual(statusSet, 400, '返回状态码应为400');
    assert.strictEqual(bodySent.success, false);
    assert.strictEqual(bodySent.error.code, 'BAD_ID');
  });

  test('R3c: cacheMiddleware — success=false (但HTTP 200，如业务空结果) 被短TTL缓存，第二次请求命中缓存且handler不重复执行', async () => {
    cacheService._memoryCache.clear();
    const mid = cacheService.cacheMiddleware('notfound', 300, { negativeTtlSec: 5 });
    let handlerCallCount = 0;
    const buildReqRes = () => ({
      req: { method: 'GET', path: '/api/v1/dramas/9999999', params: { id: '9999999' }, query: {}, user: { id: 1 } },
      res: {
        statusCode: 200,
        _json: null,
        status(s) { this.statusCode = s; return this; },
        json(b) { this._json = b; return this; },
      },
    });

    // 第一次：miss, handler返回 HTTP200 + success=false（业务层：drama不存在但返回非4xx，模拟"空列表/查不到"的场景）
    {
      const { req, res } = buildReqRes();
      await mid(req, res, () => {
        handlerCallCount++;
        // R3a 触发条件：status<400（R8放行），但 success=false → 走 negativeTtl
        res.status(200).json({ success: false, error: { code: 'NOT_FOUND' }, data: null });
      });
      assert.strictEqual(handlerCallCount, 1);
      assert.strictEqual(res._json.success, false);
    }

    // 第二次：应命中"空值短TTL缓存"，handler不再执行
    {
      const { req, res } = buildReqRes();
      let nextCalled = false;
      // mid 是 async，命中缓存时直接 res.json，return；我们直接 await mid
      await mid(req, res, () => { nextCalled = true; });
      // 命中缓存 → nextCalled=false（handler不调用）
      assert.strictEqual(nextCalled, false, 'success=false结果应使用negativeTtl缓存命中，不能进入next()');
      assert.strictEqual(handlerCallCount, 1,
        `handler不能再执行（实际=${handlerCallCount}）→ 证明空值短TTL缓存生效`);
      assert.strictEqual(res._json.success, false);
    }
  });

  test('R3d: cacheMiddleware 配合BloomFilter → "一定不存在"的 dramaId 直接404', async () => {
    const bloom = new SimpleBloomFilter(10000);
    bloom.add(1); bloom.add(2); bloom.add(3); // 只有id 1/2/3存在
    const mid = cacheService.cacheMiddleware('dramas', 300, { bloomFilter: bloom });
    let nextCalled = 0;

    // 目标 id=999999，Bloom一定没加过 → must be 404 + bloom_rejected=true
    const req = {
      method: 'GET',
      path: '/api/v1/dramas/999999',
      params: { id: '999999' },
      query: {},
      user: { id: 1 },
    };
    let s = 200; let b = null;
    const res = {
      statusCode: 200,
      status(x) { this.statusCode = s = x; return this; },
      json(x) { b = x; return this; },
    };
    await mid(req, res, () => { nextCalled++; });
    assert.strictEqual(nextCalled, 0, 'Bloom判定"绝对不存在"时handler不能被调用');
    assert.strictEqual(s, 404);
    assert.strictEqual(b.bloom_rejected, true);
  });
});

/* =========================================================================
 *  R5 + R8 + R9
 * ========================================================================= */
describe('P0-R5 (capacity配置化) + P1-R8(4xx/5xx不缓存) + P1-R9(长key摘要)', () => {
  test('R5: getStats() 返回 cluster_warning 当使用纯内存后端时', () => {
    const stats = cacheService.getStats();
    assert.ok('cluster_safe' in stats);
    assert.ok('redisAvailable' in stats);
    assert.ok(stats.maxSize >= 1000, `R5 maxSize应配置化，至少1000(默认10000)，实际=${stats.maxSize}`);
    if (!stats.redisAvailable) {
      assert.ok('cluster_warning' in stats, '内存模式必须提示cluster不一致风险');
      assert.ok(typeof stats.cluster_warning === 'string' && stats.cluster_warning.length > 0);
    }
  });

  test('R8: statusCode=500 → success=true 也绝对不能缓存', async () => {
    cacheService._memoryCache.clear();
    const mid = cacheService.cacheMiddleware('r8', 300);
    let call = 0;
    // 故意返回 500 + success=true（测试用的异常情况）
    async function runOnce() {
      const req = { method: 'GET', path: '/r8-test', query: {}, user: { id: 1 } };
      let s = 200; let b = null;
      const res = {
        statusCode: 200,
        status(x) { this.statusCode = s = x; return this; },
        json(x) { b = x; return this; },
      };
      await mid(req, res, () => {
        call++;
        res.status(500).json({ success: true, data: 'error_payload' });
      });
      return { s, b };
    }
    await runOnce();
    assert.strictEqual(call, 1);
    // 第二次应 miss（因为 statusCode=500 被排除缓存），handler再执行一次
    await runOnce();
    assert.strictEqual(call, 2, '5xx返回即使success=true也不应缓存，handler必须执行2次');
  });

  test('R9: 长query (>128 chars) 自动sha256摘要防key过长', () => {
    // 构造超长queryStr：10个参数每个30+char → ~350chars
    const parts = [];
    for (let i = 0; i < 10; i++) parts.push(`param_${i.toString().padStart(3,'0')}=${'x'.repeat(30)}`);
    const longQueryStr = parts.join('&');
    assert.ok(longQueryStr.length > 128, `必须构造出>128char的长query，actual=${longQueryStr.length}`);

    // 短的不过滤 → 原样返回
    const short = cacheService._hashQueryStr('page=1&size=20');
    assert.strictEqual(short, 'page=1&size=20');
    // 空串 → 原样
    assert.strictEqual(cacheService._hashQueryStr(''), '');

    // 长的 → sha256: 前缀 + 64hex
    const hashed = cacheService._hashQueryStr(longQueryStr);
    assert.ok(hashed.startsWith('sha256:'), `长query必须sha256前缀，actual=${hashed.substring(0,20)}...`);
    // sha256 hex 是64字符，加上 "sha256:" 共70字符
    assert.strictEqual(hashed.length, 7 + 64);
    // 相同输入 → 相同输出（确定性）
    const hashed2 = cacheService._hashQueryStr(longQueryStr);
    assert.strictEqual(hashed, hashed2);
    // buildKey组合后key的总长度是可控的
    const key = cacheService.buildKey('big-query', '/api/v1/dramas', hashed, 'u1');
    assert.ok(key.length < 300, `buildKey后的总长度不应失控，actual=${key.length}`);
  });
});

/* =========================================================================
 *  R6 — BGM 限流队列并发不超过 4
 * ========================================================================= */
describe('P0-R6: BGM异步生成 并发限流 (concurrency=4)', () => {
  test('R6a: 提交10个任务，同时运行数绝不会超过4', async () => {
    const Queue = bgmService._BgmAsyncQueue;
    assert.ok(Queue);
    assert.strictEqual(Queue.CONCURRENCY, 4, 'R6要求默认concurrency=4');

    const statsBefore = Queue.stats;
    let maxRunningSeen = 0;
    const activeAtSameTime = { now: 0, max: 0 };

    // 模拟10个BGM生成任务：每个任务运行50ms，并在运行期间记录"同时运行数峰值"
    const N = 10;
    const promises = [];
    const startedAt = new Map(); // idx → startTime
    for (let i = 0; i < N; i++) {
      promises.push(Queue.add(async () => {
        activeAtSameTime.now++;
        activeAtSameTime.max = Math.max(activeAtSameTime.max, activeAtSameTime.now);
        await new Promise(r => setTimeout(r, 30));
        activeAtSameTime.now--;
        return i;
      }));
    }
    await Promise.all(promises);
    await Queue._drain();

    assert.ok(activeAtSameTime.max <= Queue.CONCURRENCY,
      `R6限流失败：同时运行峰值=${activeAtSameTime.max} > limit=${Queue.CONCURRENCY}`);
    assert.ok(activeAtSameTime.max >= 1, '至少跑了1个任务');
    // N=10, concurrency=4, 每个30ms → 预期 3批（4+4+2）≈ 90ms
    const statsAfter = Queue.stats;
    assert.strictEqual(statsAfter.submitted - statsBefore.submitted, N, '提交数应=10');
    assert.strictEqual(statsAfter.completed - statsBefore.completed, N, '完成数应=10');
    assert.strictEqual(statsAfter.running, 0, '空闲');
    assert.strictEqual(statsAfter.queued, 0, '无排队');
  });
});

/* =========================================================================
 *  ObjectIdGuard 循环引用检测（cdnService R12的前置依赖工具）
 * ========================================================================= */
describe('Utils-ObjectIdGuard: 循环引用防护', () => {
  test('guard: 相同对象第二次访问直接返回true（跳过）', () => {
    const guard = new ObjectIdGuard();
    const a = { name: 'a' };
    assert.strictEqual(guard.checkAndMark(a), false);
    assert.strictEqual(guard.checkAndMark(a), true); // 第二次应被拦截
    const b = { name: 'b' };
    assert.strictEqual(guard.checkAndMark(b), false); // 新对象不拦
  });
  test('guard: null/非对象直接false', () => {
    const guard = new ObjectIdGuard();
    assert.strictEqual(guard.checkAndMark(null), false);
    assert.strictEqual(guard.checkAndMark(123), false);
    assert.strictEqual(guard.checkAndMark('x'), false);
  });
});
