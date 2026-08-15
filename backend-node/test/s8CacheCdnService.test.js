'use strict';

/**
 * s8CacheCdnService.test.js
 * Sprint 8 - S8-T07/T08: 缓存层 + CDN加速 单元测试
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');

const cacheService = require('../src/services/cacheService');
const cdnService = require('../src/services/cdnService');

describe('S8-T07: API响应缓存层', () => {
  test('1. MemoryLRU — set/get 基本操作', async () => {
    const lru = cacheService._memoryCache;
    lru.clear();
    await cacheService.set('test:key1', { data: 'hello' }, 10);
    const value = await cacheService.get('test:key1');
    assert.deepStrictEqual(value, { data: 'hello' });
  });

  test('2. MemoryLRU — miss 返回 null', async () => {
    const value = await cacheService.get('nonexistent:key');
    assert.strictEqual(value, null);
  });

  test('3. MemoryLRU — del 删除缓存', async () => {
    await cacheService.set('test:key2', 'value2', 10);
    await cacheService.del('test:key2');
    const value = await cacheService.get('test:key2');
    assert.strictEqual(value, null);
  });

  test('4. MemoryLRU — delPattern 模式删除', async () => {
    await cacheService.set('s8:dramas:list:u1', 'data1', 10);
    await cacheService.set('s8:dramas:list:u2', 'data2', 10);
    await cacheService.set('s8:other:key', 'data3', 10);
    const count = await cacheService.delPattern('s8:dramas:list:*');
    assert.ok(count >= 2);
    assert.strictEqual(await cacheService.get('s8:dramas:list:u1'), null);
    assert.strictEqual(await cacheService.get('s8:dramas:list:u2'), null);
    assert.ok(await cacheService.get('s8:other:key') !== null);
  });

  test('5. MemoryLRU — buildKey 构建 key', () => {
    const key = cacheService.buildKey('dramas', 'list', 'u1');
    assert.ok(key.startsWith('s8:dramas:'));
    assert.ok(key.includes('list'));
    assert.ok(key.includes('u1'));
  });

  test('6. cacheMiddleware — GET 请求命中缓存', async () => {
    cacheService._memoryCache.clear();
    let handlerCallCount = 0;

    const createFakeReqRes = () => ({
      req: { method: 'GET', path: '/test', query: { page: '1' }, user: { id: 1 } },
      res: { _body: null, json(body) { this._body = body; } },
    });

    const middleware = cacheService.cacheMiddleware('test', 60);
    const handler = (req, res) => {
      handlerCallCount++;
      res.json({ success: true, data: { value: 'computed' } });
    };

    // 第一次请求：miss，执行 handler
    const { req: req1, res: res1 } = createFakeReqRes();
    await new Promise((resolve) => {
      middleware(req1, res1, () => { handler(req1, res1); resolve(); });
    });
    assert.strictEqual(handlerCallCount, 1);
    assert.deepStrictEqual(res1._body.data, { value: 'computed' });

    // 第二次请求：应命中缓存，不执行 handler
    const { req: req2, res: res2 } = createFakeReqRes();
    // 缓存命中时 middleware 直接调用 res.json 而非 next
    await new Promise((resolve) => {
      middleware(req2, res2, resolve);
      // 如果缓存命中，res.json 会被调用，此时也 resolve
      setTimeout(resolve, 100);
    });
    // handlerCallCount 应仍为 1（缓存命中，不执行 handler）
    assert.strictEqual(handlerCallCount, 1);
    assert.deepStrictEqual(res2._body.data, { value: 'computed' });
  });

  test('7. cacheMiddleware — 非 GET 请求不缓存', async () => {
    const fakeReq = { method: 'POST', path: '/test', query: {}, user: null };
    let nextCalled = false;
    const middleware = cacheService.cacheMiddleware('test', 60);
    await new Promise((resolve) => {
      middleware(fakeReq, { json() {} }, () => { nextCalled = true; resolve(); });
    });
    assert.strictEqual(nextCalled, true);
  });

  test('8. getStats — 返回统计信息', () => {
    const stats = cacheService.getStats();
    assert.ok(stats.backend);
    assert.ok(typeof stats.size === 'number');
    assert.ok(typeof stats.hits === 'number');
    assert.ok(typeof stats.misses === 'number');
  });

  test('9. invalidateDramaCache — 失效项目缓存', async () => {
    await cacheService.set('s8:drama_detail:99001:detail', 'data', 10);
    const count = await cacheService.invalidateDramaCache(99001);
    assert.ok(count >= 0);
  });
});

describe('S8-T08: 图片CDN加速', () => {
  /**
   * 使用模块级单例缓存直接 patch getCdnConfig 返回的对象，避免"delete require.cache + env"
   * 因 config.yaml 存在而失效的老问题（原测试假设env会覆盖config，但getCdnConfig中
   * 有真实yaml时不会用fallback env逻辑，老代码在有config.yaml的环境下运行总会失败）。
   * fn执行完后会原样恢复原配置字段。
   */
  function withCdnEnabled(patch, fn) {
    const cfg = cdnService.getCdnConfig();
    const saved = { ...cfg };
    try {
      Object.assign(cfg, {
        enabled: true,
        base_url: 'https://cdn.example.com',
        enable_webp: true,
        ...patch,
      });
      return fn(cdnService);
    } finally {
      // 逐个字段恢复，保留引用（单例缓存）
      for (const k of Object.keys(cfg)) delete cfg[k];
      Object.assign(cfg, saved);
    }
  }

  test('10. isLocalPath — 识别本地路径', () => {
    assert.strictEqual(cdnService.isLocalPath('/static/images/123.jpg'), true);
    assert.strictEqual(cdnService.isLocalPath('/uploads/test.png'), true);
    assert.strictEqual(cdnService.isLocalPath('https://cdn.example.com/img.jpg'), false);
    assert.strictEqual(cdnService.isLocalPath(null), false);
    assert.strictEqual(cdnService.isLocalPath(''), false);
  });

  test('11. rewriteUrl — CDN 未启用时返回原始 URL', () => {
    withCdnEnabled({ enabled: false }, (cdn) => {
      const url = cdn.rewriteUrl('/static/images/test.jpg');
      assert.strictEqual(url, '/static/images/test.jpg');
    });
  });

  test('12. rewriteUrl — CDN 启用时重写 URL', () => {
    withCdnEnabled({}, (cdn) => {
      const url = cdn.rewriteUrl('/static/images/test.jpg', { width: 320, quality: 80 });
      assert.ok(url.startsWith('https://cdn.example.com/static/images/test.jpg'));
      assert.ok(url.includes('w=320'));
      assert.ok(url.includes('q=80'));
      assert.ok(url.includes('f=webp'));
    });
  });

  test('13. rewriteUrl — 非本地路径不重写', () => {
    withCdnEnabled({}, (cdn) => {
      const url = cdn.rewriteUrl('https://other.com/image.jpg');
      assert.strictEqual(url, 'https://other.com/image.jpg');
    });
  });

  test('14. getThumbnailUrl — 生成缩略图 URL', () => {
    withCdnEnabled({}, (cdn) => {
      const url = cdn.getThumbnailUrl('/static/images/test.jpg', 160);
      assert.ok(url.includes('w=160'));
      assert.ok(url.includes('q=70'));
    });
  });

  test('15. getResponsiveUrls — 生成响应式 URL 列表', () => {
    withCdnEnabled({}, (cdn) => {
      const urls = cdn.getResponsiveUrls('/static/images/test.jpg');
      assert.ok(Array.isArray(urls));
      assert.ok(urls.length > 0);
      urls.forEach(u => {
        assert.ok(u.url);
        assert.ok(u.width > 0);
      });
    });
  });

  test('16. getSrcset — 生成 srcset 字符串', () => {
    withCdnEnabled({}, (cdn) => {
      const srcset = cdn.getSrcset('/static/images/test.jpg');
      assert.ok(typeof srcset === 'string');
      assert.ok(srcset.includes('w'));
    });
  });

  test('17. rewriteObjectUrls — 递归重写对象 URL', () => {
    withCdnEnabled({}, (cdn) => {
      const obj = {
        image_url: '/static/test.jpg',
        name: 'test',
        nested: {
          thumbnail: '/static/thumb.jpg',
        },
        list: [
          { cover: '/static/cover.jpg' },
        ],
      };
      const result = cdn.rewriteObjectUrls(obj, { width: 320 });
      assert.ok(result.image_url.startsWith('https://cdn.example.com'));
      assert.ok(result.nested.thumbnail.startsWith('https://cdn.example.com'));
      assert.ok(result.list[0].cover.startsWith('https://cdn.example.com'));
      assert.strictEqual(result.name, 'test');
    });
  });

  test('18. getStatus — 返回 CDN 状态', () => {
    // 默认当前配置（不管enabled与否，都应返回这些字段）
    const status = cdnService.getStatus();
    assert.ok(typeof status.enabled === 'boolean');
    assert.ok(typeof status.image_quality === 'number');
    assert.ok(typeof status.enable_webp === 'boolean');
    assert.ok(Array.isArray(status.thumbnail_sizes));
  });

  test('19. rewriteUrls — 批量重写', () => {
    withCdnEnabled({}, (cdn) => {
      const urls = ['/static/a.jpg', '/static/b.png', 'https://other.com/c.jpg'];
      const result = cdn.rewriteUrls(urls, { width: 640 });
      assert.ok(result[0].startsWith('https://cdn.example.com'));
      assert.ok(result[1].startsWith('https://cdn.example.com'));
      assert.strictEqual(result[2], 'https://other.com/c.jpg');
    });
  });

  test('20. getImgAttributes — 生成完整 img 属性', () => {
    withCdnEnabled({}, (cdn) => {
      const attrs = cdn.getImgAttributes('/static/test.jpg', '描述');
      assert.ok(attrs.src);
      assert.ok(attrs.srcset);
      assert.strictEqual(attrs.alt, '描述');
      assert.strictEqual(attrs.loading, 'lazy');
      assert.strictEqual(attrs.decoding, 'async');
    });
  });
});
