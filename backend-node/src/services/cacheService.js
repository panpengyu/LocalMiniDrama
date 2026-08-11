'use strict';

/**
 * cacheService.js
 * Sprint 8 - S8-T07 + S8-RiskFixes (R1/R2/R3/R5 + P1 R7/R8/R9)
 *
 * ===== Cluster部署注意事项 =====
 * 本模块的 MemoryLRU 是进程内部的 Map。当使用 PM2 cluster 模式启动 N 个进程时：
 *   ❌ 同一份数据会被缓存 N 份（内存浪费）
 *   ❌ 各进程的命中率、TTL、invalidate 互不相同（缓存不一致）
 *   ❌ singleflight 仅能合并"同一进程内"的并发，跨进程无法合并
 *  ✅ 解决方案：在 config.yaml 中配置 redis.host/port 后，通过 initRedis() 启用 Redis，
 *     所有进程共享同一个 Redis 后端，自动解决以上三个问题。
 *     也可在 Redis 侧配合 Redisson 分布式锁补充 singleflight 跨进程合并（若需要极致优化）。
 * =================================
 *
 * 修复清单：
 *  R1  MemoryLRU.set() 竞态 —— _timerMap 绑定每个key的timeoutId，覆盖时先清旧定时器；
 *                                  淘汰流程包装在 _atomicEvictOne() 中（虽然单线程V8无抢占，但显式标注语义边界）
 *  R2  缓存击穿 —— cacheMiddleware 中通过 Singleflight，缓存未命中时合并同key的并发DB请求
 *  R3  缓存穿透 —— a) success=false 也缓存短TTL(30s)；b) 数值型路径参数 NaN 检查直接拒绝；
 *                    c) 导出 SimpleBloomFilter 实例工厂 + preloadDramaIds() 辅助函数
 *  R5  maxSize 配置化 —— 从 config.cache.lru_max_size 读取（默认10000，原硬编码500偏小）；
 *                        getStats() 返回 cluster_warning 字段
 *  R7  P1: Redis delPattern 禁用 KEYS —— 改用 scanIterator 分批迭代（生产环境主线程不阻塞）
 *  R8  P1: 4xx/5xx 不缓存 —— cacheMiddleware中 `res.statusCode < 400 && body.success` 才行
 *  R9  P1: 过长key摘要 —— cacheMiddleware中queryStr用sha256压缩到64字符hex
 */

const crypto = require('crypto');
const { loadConfig } = require('../config/index.js');
const { Singleflight, SimpleBloomFilter } = require('../utils/concurrency.js');

let redisClient = null;
let redisAvailable = false;
let initAttempted = false;

/* =========================================================================
 * 调试辅助：长key截断到前60字符（日志可读性）
 * ========================================================================= */
function _shortKey(key) {
  if (!key) return String(key);
  const s = String(key);
  return s.length <= 60 ? s : (s.substring(0, 57) + '...');
}

/* =========================================================================
 * MemoryLRU (R1/R5修复)
 * ========================================================================= */
class MemoryLRU {
  constructor(maxSize) {
    // R5：maxSize 从外部传入（由 config.cache.lru_max_size 决定）
    this.maxSize = Number.isFinite(maxSize) && maxSize > 10 ? maxSize : 10000;
    this.cache = new Map();
    this.hits = 0;
    this.misses = 0;
    // R1：每个key绑定一个timeoutId，覆盖前先清除旧定时器，防止"新值被旧TTL提前删掉"
    this._timerMap = new Map();
    // 用于统计：被定时器正确回收的条目 vs 被手动淘汰的条目
    this._evictCounter = 0;
    this._ttlRecycleCounter = 0;
  }

  get(key) {
    if (!this.cache.has(key)) {
      this.misses++;
      console.log(`[LRU] MISS  key=${_shortKey(key)}  (size=${this.cache.size}/${this.maxSize})`);
      return null;
    }
    const value = this.cache.get(key);
    // LRU refresh: 先delete再set，将该key移动到插入顺序尾部（代表"最近使用"）
    this.cache.delete(key);
    this.cache.set(key, value);
    this.hits++;
    const hitRate = ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%';
    console.log(`[LRU] HIT   key=${_shortKey(key)}  hitRate=${hitRate}  timerActive=${this._timerMap.has(key)}`);
    return value;
  }

  /**
   * R1：原子淘汰 + 定时器去重
   * 该方法不yield（纯同步），在Node单线程里天然是原子的；单独抽离作为语义边界
   */
  _atomicEvictOne() {
    // Map.keys()按插入顺序迭代，第一个就是最久未用的
    const iter = this.cache.keys().next();
    if (iter.done) return;
    const firstKey = iter.value;
    this.cache.delete(firstKey);
    // 同步清理该key的旧定时器，防止过期后还delete不存在的key（白跑）
    const oldT = this._timerMap.get(firstKey);
    let hadTimer = false;
    if (oldT) {
      clearTimeout(oldT);
      this._timerMap.delete(firstKey);
      hadTimer = true;
    }
    this._evictCounter++;
    console.log(`[LRU] EVICT key=${_shortKey(firstKey)}  hadTimer=${hadTimer}  evictCount=${this._evictCounter}  (sizeAfter=${this.cache.size})`);
  }

  set(key, value, ttlMs) {
    // R1-a：如果该key已存在，必须先清除旧TTL定时器，否则旧定时器会在错误的时机删除新写入的值
    const existingTimer = this._timerMap.get(key);
    const isOverwrite = this.cache.has(key);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this._timerMap.delete(key);
      console.log(`[LRU] TIMER-CLEAR (overwrite) key=${_shortKey(key)}`);
    }

    let evictedCount = 0;
    // 淘汰到 size < maxSize 为止（通常只需1次；这里用while防御极端重入）
    while (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this._atomicEvictOne();
      evictedCount++;
    }

    this.cache.set(key, value);

    // R1-b：注册新TTL并记录timerId到_timerMap
    if (ttlMs && ttlMs > 0) {
      const tid = setTimeout(() => {
        const had = this.cache.delete(key);
        this._timerMap.delete(key);
        this._ttlRecycleCounter++;
        console.log(`[LRU] TTL-EXPIRE key=${_shortKey(key)}  wasPresent=${had}  ttlRecycle=${this._ttlRecycleCounter}`);
      }, ttlMs);
      // 防止 setTimeout 的 timer 对象常驻事件循环导致进程无法正常退出的情况（开发态）
      // 给timeout加unref，仅当该timeout是进程中"最后一个未完成句柄"时允许Node退出
      if (typeof tid.unref === 'function') tid.unref();
      this._timerMap.set(key, tid);
    }
    console.log(`[LRU] SET   key=${_shortKey(key)}  overwrite=${isOverwrite}  evicted=${evictedCount}  ttlMs=${ttlMs || 0}  (size=${this.cache.size}/${this.maxSize})`);
  }

  del(key) {
    const t = this._timerMap.get(key);
    if (t) {
      clearTimeout(t);
      this._timerMap.delete(key);
      console.log(`[LRU] TIMER-CLEAR (del) key=${_shortKey(key)}`);
    }
    const had = this.cache.delete(key);
    console.log(`[LRU] DEL   key=${_shortKey(key)}  wasPresent=${had}`);
    return had;
  }

  delPattern(pattern) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
    let count = 0;
    for (const key of Array.from(this.cache.keys())) {
      if (regex.test(key)) {
        this.del(key);
        count++;
      }
    }
    console.log(`[LRU] DEL-PATTERN pattern=${pattern}  matched=${count}`);
    return count;
  }

  clear() {
    const n = this._timerMap.size;
    for (const tid of this._timerMap.values()) {
      clearTimeout(tid);
    }
    this._timerMap.clear();
    this.cache.clear();
    console.log(`[LRU] CLEAR  clearedTimers=${n}`);
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      backend: 'memory',
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      active_timers: this._timerMap.size,
      evict_count: this._evictCounter,
      ttl_recycle_count: this._ttlRecycleCounter,
      hitRate: total > 0 ? (this.hits / total * 100).toFixed(2) + '%' : '0%',
    };
  }
}

/* ========== MemoryLRU 实例（R5: 从 config 读取容量） ========== */
let _cfgCache;
try {
  _cfgCache = loadConfig();
} catch (e) {
  console.warn('[CACHE] 读取config失败，使用默认LRU容量');
  _cfgCache = {};
}
const LRU_MAX_SIZE = Number(_cfgCache.cache?.lru_max_size) || 10000;
const memoryCache = new MemoryLRU(LRU_MAX_SIZE);

/* ========== Singleflight 全局实例 (R2: 缓存击穿防护) ========== */
const sf = new Singleflight();

/* =========================================================================
 * Redis 初始化
 * ========================================================================= */
async function initRedis() {
  if (initAttempted) return redisAvailable;
  initAttempted = true;
  try {
    const config = loadConfig();
    const redisConfig = config.redis;
    if (!redisConfig || !redisConfig.host) {
      console.log(`[CACHE] Redis 未配置，使用内存缓存降级 (LRU max=${LRU_MAX_SIZE})`);
      return false;
    }
    const redis = require('redis');
    redisClient = redis.createClient({
      socket: {
        host: redisConfig.host || 'localhost',
        port: redisConfig.port || 6379,
      },
      password: redisConfig.password || undefined,
      database: redisConfig.db || 0,
    });
    redisClient.on('error', (err) => {
      console.warn('[CACHE] Redis 错误，降级到内存缓存:', err.message);
      redisAvailable = false;
    });
    redisClient.on('connect', () => {
      console.log('[CACHE] Redis 连接成功');
      redisAvailable = true;
    });
    await redisClient.connect();
    redisAvailable = true;
    console.log('[CACHE] Redis 缓存层已启用 (cluster模式不再有不一致风险)');
    return true;
  } catch (err) {
    console.warn('[CACHE] Redis 初始化失败，降级到内存缓存:', err.message);
    redisAvailable = false;
    return false;
  }
}

/* =========================================================================
 * Key 构建 (P1-R9: query串过长时sha256摘要)
 * ========================================================================= */
function buildKey(prefix, ...parts) {
  return `s8:${prefix}:${parts.join(':')}`;
}
function hashQueryStr(queryStr) {
  if (!queryStr || queryStr.length < 128) return queryStr; // 短的直接用，便于排查
  return 'sha256:' + crypto.createHash('sha256').update(queryStr).digest('hex');
}

/* =========================================================================
 * get / set / del
 * ========================================================================= */
async function get(key) {
  if (redisAvailable && redisClient) {
    try {
      const value = await redisClient.get(key);
      if (value) {
        console.log(`[CACHE] HIT (redis): ${key.substring(0, 60)}`);
        return JSON.parse(value);
      }
      return null;
    } catch (err) {
      console.warn(`[CACHE] Redis GET 失败，降级内存: ${key}`, err.message);
    }
  }
  const memValue = memoryCache.get(key);
  if (memValue !== null) {
    console.log(`[CACHE] HIT (memory): ${key.substring(0, 60)}`);
  }
  return memValue;
}

async function set(key, value, ttlSec = 300) {
  const serialized = JSON.stringify(value);
  if (redisAvailable && redisClient) {
    try {
      await redisClient.set(key, serialized, { EX: ttlSec });
      return;
    } catch (err) {
      console.warn(`[CACHE] Redis SET 失败，降级内存: ${key}`, err.message);
    }
  }
  memoryCache.set(key, value, ttlSec * 1000);
}

async function del(key) {
  if (redisAvailable && redisClient) {
    try {
      await redisClient.del(key);
    } catch (err) {
      console.warn(`[CACHE] Redis DEL 失败: ${key}`, err.message);
    }
  }
  memoryCache.del(key);
}

/* =========================================================================
 * delPattern — R7: Redis禁用KEYS(O(N阻塞)),改用scanIterator(分批迭代,无阻塞)
 * ========================================================================= */
async function delPattern(pattern) {
  if (redisAvailable && redisClient) {
    try {
      let deleted = 0;
      const toDelete = [];
      // 每批200条；scanIterator是异步Generator，不会阻塞Redis主线程
      for await (const key of redisClient.scanIterator({ MATCH: pattern, COUNT: 200 })) {
        toDelete.push(key);
      }
      if (toDelete.length > 0) {
        // pipeline批量删除，减少RTT
        deleted = await redisClient.del(toDelete);
        console.log(`[CACHE] Redis 批量删除 ${deleted}/${toDelete.length} 个键(SCAN): ${pattern}`);
      }
      return deleted;
    } catch (err) {
      console.warn(`[CACHE] Redis SCAN/DEL 失败: ${pattern}`, err.message);
    }
  }
  return memoryCache.delPattern(pattern);
}

/* =========================================================================
 * cacheMiddleware — R2(击穿/R singleflight) + R3(穿透/空值缓存) +
 *                   R8(4xx/5xx不缓存) + R9(长key摘要)
 * ========================================================================= */
function cacheMiddleware(prefix, ttlSec = 300, options = {}) {
  // R3: 空值/失败结果 的短TTL（防止穿透），默认30秒
  const negativeTtlSec = options.negativeTtlSec ?? 30;
  // R3: 可选的 bloomFilter 实例（用于"一定不存在"的数值型id直接拦截）
  const bloom = options.bloomFilter || null;
  // 数值型参数的快速失败拦截
  const numericParams = (options.numericParams || ['id', 'dramaId', 'drama_id', 'episodeId', 'characterId', 'sceneId']);

  return async (req, res, next) => {
    if (req.method !== 'GET') return next();

    // ===== R3-b: 数值型参数 NaN 快速失败，防止穿透到DB =====
    for (const p of numericParams) {
      const v = req.params?.[p] ?? req.query?.[p];
      if (v !== undefined && v !== null && v !== '') {
        const n = Number(v);
        if (Number.isNaN(n) || !Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          console.log(`[CACHE-R3] BAD_ID 拦截 param=${p}  value="${v}"  method=${req.method}  path=${req.path}  ip=${req.ip}`);
          return res.status(400).json({
            success: false,
            error: { code: 'BAD_ID', message: `参数 ${p} 必须为正整数` },
          });
        }
        // ===== R3-c: 布隆过滤器 "一定不存在" 直接404 =====
        if (bloom && (p === 'dramaId' || p === 'drama_id' || p === 'id')) {
          if (!bloom.mightContain(n)) {
            console.log(`[CACHE-R3] BLOOM 拦截  param=${p}  id=${n}  path=${req.path} (布隆判定一定不存在→404)`);
            return res.status(404).json({
              success: false,
              error: { code: 'NOT_FOUND', message: '资源不存在（Bloom拦截）' },
              bloom_rejected: true,
            });
          } else {
            console.log(`[CACHE-R3] BLOOM 放行  param=${p}  id=${n}（布隆通过→继续查DB）`);
          }
        }
      }
    }

    // ===== R9: 长query用sha256，避免缓存key过长 =====
    const rawQueryStr = Object.keys(req.query)
      .sort()
      .map(k => `${k}=${req.query[k]}`)
      .join('&');
    const queryStr = hashQueryStr(rawQueryStr);
    const userId = req.user?.id || 'anon';
    const key = buildKey(prefix, req.path, queryStr, `u${userId}`);
    if (rawQueryStr !== queryStr) {
      console.log(`[CACHE-R9] LONG-KEY 摘要  rawQuery=${rawQueryStr.length}chars → key=${_shortKey(key)}`);
    }

    // ===== 尝试读取缓存 =====
    try {
      const cached = await get(key);
      if (cached) {
        console.log(`[CACHE-MW] 命中缓存 → 直接返回  key=${_shortKey(key)}`);
        return res.json(cached);
      } else {
        console.log(`[CACHE-MW] 未命中缓存 → 进入Singleflight/DB  key=${_shortKey(key)}`);
      }
    } catch (_) {
      // 缓存层异常不能影响业务，静默继续
    }

    // ===== R2: Singleflight — 合并同key并发，避免击穿到DB =====
    const sfKey = `sf:${key}`;
    const inflightBefore = sf.inflight ? sf.inflight.size : -1;
    console.log(`[SF] 开始请求 sfKey=${_shortKey(sfKey)}  进入前inflight=${inflightBefore}  path=${req.path}  user=${userId}`);
    try {
      await sf.do(sfKey, async () => {
        const myWaiters = sf.inflight ? ((sf.inflight.get(sfKey)?.waiters) ?? 0) : 'N/A';
        console.log(`[SF] 执行业务 sfKey=${_shortKey(sfKey)}  当前同key waiters≈${myWaiters}`);
        // —— Double-check（可能上一个inflight刚完成，缓存已写入）——
        const cachedAfterWait = await get(key);
        if (cachedAfterWait) {
          console.log(`[SF] 二次检查命中（前一个inflight刚完成） → 直接返回  key=${_shortKey(key)}`);
          res.json(cachedAfterWait);
          return;
        }

        // ===== 捕获一次原始res.json，写入缓存 =====
        const originalJson = res.json.bind(res);
        let bodyCaptured = null;
        let jsonCalled = false;
        res.json = function (body) {
          jsonCalled = true;
          bodyCaptured = body;
          const statusCode = Number.isFinite(res.statusCode) ? res.statusCode : 200;
          let cachedHere = false;
          let effTtl = null;
          if (body && statusCode < 400) {
            // R3-a: 成功(success=true) 长TTL；失败(success=false) 短TTL防穿透
            const effectiveTtl = body.success === true ? ttlSec : negativeTtlSec;
            cachedHere = true;
            effTtl = effectiveTtl;
            set(key, body, effectiveTtl).catch(() => {});
          } else {
            console.log(`[CACHE-R8] 不缓存 status=${statusCode}  body.success=${body?.success}  key=${_shortKey(key)}`);
          }
          const ret = originalJson(body);
          console.log(`[CACHE-MW] 业务res.json被捕获  cached=${cachedHere}  effTtl=${effTtl}s  body.success=${body?.success}  status=${statusCode}`);
          if (!waitedDone) {
            waitedDone = true;
            if (resolveInner) resolveInner();
          }
          return ret;
        };

        // ===== 交给业务handler执行 =====
        let waitedDone = false;
        let resolveInner;
        await new Promise((resolve, reject) => {
          resolveInner = resolve;
          // 兜底：120s后强制resolve。如果后端handler没按规范调res.json（比如res.send/redirect/end），
          // Singleflight绝对不能挂死，否则后续同key请求永远拿不到结果。
          const guardTimer = setTimeout(() => {
            if (waitedDone) return;
            waitedDone = true;
            console.log(`[CACHE-MW] ⚠️  业务handler 120s内未调res.json → 兜底释放Singleflight  key=${_shortKey(key)}`);
            resolve();
          }, 120000);
          try {
            // ⚠️ 重要：Express 4.x 中 next(fn) 会把 fn 当作 Error 对象传给错误处理中间件！
            // 必须使用无参 next() 让后续业务handler正常执行；res.json 钩子内部会 resolveInner。
            const r = next();
            if (r && typeof r.catch === 'function') {
              r.catch((err) => {
                if (waitedDone) return;
                waitedDone = true;
                clearTimeout(guardTimer);
                reject(err);
              });
            }
          } catch (err) {
            if (waitedDone) return;
            waitedDone = true;
            clearTimeout(guardTimer);
            reject(err);
          }
        });

        // 业务handler调res.json时会在钩子内部 resolveInner，并设置 jsonCalled=true
        if (!jsonCalled) {
          res.json = originalJson;
          console.log(`[CACHE-MW] handler 未调用 res.json（可能用了res.send/redirect/end）→ 跳过缓存写入  key=${_shortKey(key)}`);
        }
        waitedDone = true;
      });
      console.log(`[SF] 完成 sfKey=${_shortKey(sfKey)}  剩余inflight=${sf.inflight ? sf.inflight.size : 'N/A'}`);
    } catch (err) {
      console.log(`[SF] 异常 sfKey=${_shortKey(sfKey)}  err=${err.message}`);
      next(err);
    }
  };
}

/* =========================================================================
 * 项目相关缓存失效
 * ========================================================================= */
async function invalidateDramaCache(dramaId) {
  const patterns = [
    `s8:dramas:*:u*`,
    `s8:drama_detail:${dramaId}:*`,
    `s8:storyboards:${dramaId}:*`,
    `s8:characters:${dramaId}:*`,
    `s8:scenes:${dramaId}:*`,
  ];
  let total = 0;
  for (const p of patterns) {
    total += await delPattern(p);
  }
  console.log(`[CACHE] 项目 ${dramaId} 缓存失效 ${total} 个键`);
  return total;
}

/* =========================================================================
 * R3/Bloom 新增项目/更新项目的钩子（修复新建项目立刻被Bloom误判的致命bug）
 *   —— app.js 启动时注册 bloom 引用，dramaService 写操作后回调
 * ========================================================================= */
let _dramaBloomRef = null;
function registerDramaBloomForUpdates(bloom) {
  _dramaBloomRef = bloom || null;
  console.log(`[CACHE] dramaBloom 已注册到写操作通知器  ok=${!!_dramaBloomRef}`);
}
/** 新建drama后调用：把新id加入布隆过滤器 + 失效列表缓存 */
async function notifyDramaCreated(dramaId) {
  const idNum = Number(dramaId);
  if (!Number.isInteger(idNum) || idNum <= 0) return;
  if (_dramaBloomRef) {
    _dramaBloomRef.add(idNum);
    const fr = typeof _dramaBloomRef.fillRate === 'number'
      ? (_dramaBloomRef.fillRate * 100).toFixed(4) + '%'
      : 'N/A';
    console.log(`[CACHE-R3] Bloom ADD dramaId=${idNum}  fillRate=${fr}`);
  } else {
    console.log(`[CACHE-R3] Bloom 未注册 → 跳过 add(dramaId=${idNum})（新建详情页可能Bloom误判404，请在app.js注册）`);
  }
  // 列表页缓存必须清（否则新剧出不来）
  await invalidateDramaCache(idNum);
}
/** 更新drama后调用：仅失效缓存（Bloom不需要更新） */
async function notifyDramaUpdated(dramaId) {
  const idNum = Number(dramaId);
  if (!Number.isInteger(idNum) || idNum <= 0) return;
  console.log(`[CACHE] 项目已更新 → 失效缓存  dramaId=${idNum}`);
  await invalidateDramaCache(idNum);
}
/** 删除drama后调用：仅失效缓存（Bloom不支持单条删除，保留不会报错） */
async function notifyDramaDeleted(dramaId) {
  const idNum = Number(dramaId);
  if (!Number.isInteger(idNum) || idNum <= 0) return;
  console.log(`[CACHE] 项目已删除 → 失效缓存  dramaId=${idNum}`);
  await invalidateDramaCache(idNum);
}

/* =========================================================================
 * R3 辅助：创建 BloomFilter 并从 DB 预加载所有存在过的 drama_id
 *   用法：在 app.js 启动后：
 *     const bloom = cacheService.createDramaBloom(db);
 *     const mid = cacheService.cacheMiddleware('xxx', 300, { bloomFilter: bloom });
 * ========================================================================= */
function createDramaBloom(capacity = 200000) {
  return new SimpleBloomFilter(capacity, 0.005);
}
async function preloadDramaIdsIntoBloom(db, bloom) {
  if (!db || !bloom) return 0;
  const stmt = db.prepare ? db.prepare('SELECT id FROM dramas') : null;
  if (!stmt) return 0;
  const rows = stmt.all();
  for (const r of rows) if (r && typeof r.id === 'number') bloom.add(r.id);
  console.log(`[CACHE] BloomFilter 预加载 dramas: ${rows.length} 条 (fillRate=${bloom.fillRate})`);
  return rows.length;
}

/* =========================================================================
 * 统计信息 (附 Cluster 模式警告)
 * ========================================================================= */
function getStats() {
  const base = memoryCache.getStats();
  if (redisAvailable && redisClient) {
    return {
      ...base,
      backend: 'redis',
      redisAvailable: true,
      cluster_safe: true,
      singleflight_inflight: sf.inflightCount,
    };
  }
  // 纯内存模式，提示 Cluster 风险 (R5 反馈)
  return {
    ...base,
    redisAvailable: false,
    cluster_safe: false,
    cluster_warning:
      '当前使用内存缓存。PM2 cluster模式下多进程会导致命中率分散/缓存不一致，请配置Redis并调用initRedis()。',
    singleflight_inflight: sf.inflightCount,
  };
}

module.exports = {
  // 核心生命周期
  initRedis,
  // 读写
  get,
  set,
  del,
  delPattern,
  // 路由中间件
  cacheMiddleware,
  buildKey,
  _hashQueryStr: hashQueryStr, // 仅测试: 长key摘要函数
  // 失效
  invalidateDramaCache,
  // R3 Bloom写操作钩子（修复新建项目Bloom误判）
  registerDramaBloomForUpdates,
  notifyDramaCreated,
  notifyDramaUpdated,
  notifyDramaDeleted,
  // 穿透防护 (R3)
  createDramaBloom,
  preloadDramaIdsIntoBloom,
  SimpleBloomFilter,
  Singleflight,
  // 统计
  getStats,
  // 仅内部/测试使用
  _memoryCache: memoryCache,
  _singleflight: sf,
};
