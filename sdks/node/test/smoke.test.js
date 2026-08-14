'use strict';

/**
 * Node SDK 冒烟测试：注入自定义 fetch，验证真实 request 流程：
 *   1) 请求 URL / 方法 / 鉴权头构造正确
 *   2) 成功路径数据解包（success/data）
 *   3) query 参数拼装
 *   4) 网关错误归一化为 OpenApiError（status/code）
 */
const assert = require('node:assert/strict');
const { OpenApiClient, OpenApiError } = require('../index.js');

function run() {
  let capturedUrl = null;
  // --- 用例1：成功路径 + 鉴权头 ---
  let captured;
  const c1 = new OpenApiClient({
    baseUrl: 'http://test/api/v1/open',
    apiKey: 'lmd_k1',
    fetch: async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 201, json: async () => ({ success: true, data: { id: 1, title: 't' } }) };
    },
  });

  c1.createDrama({ title: 't' }).then((drama) => {
    assert.equal(drama.id, 1);
    assert.equal(drama.title, 't');
    assert.equal(captured.opts.method, 'POST');
    assert.equal(captured.opts.headers['X-API-Key'], 'lmd_k1');
    assert.equal(captured.opts.headers['Content-Type'], 'application/json');
    assert.match(String(captured.url), /\/api\/v1\/open\/dramas$/);
    assert.ok(JSON.parse(captured.opts.body).title === 't');
    console.log('✓ 成功路径数据解包与鉴权头');

    // --- 用例2：query 参数拼装 ---
    const c2 = new OpenApiClient({
      baseUrl: 'http://test/api/v1/open',
      apiKey: 'lmd_k2',
      fetch: async (url) => { capturedUrl = url; return { ok: true, status: 200, json: async () => ({ success: true, data: { items: [], pagination: {} } }) }; },
    });
    return c2.listDramas({ page: 2, page_size: 30, status: 'draft', empty: '' });
  }).then(() => {
    assert.equal(capturedUrl.searchParams.get('page'), '2');
    assert.equal(capturedUrl.searchParams.get('page_size'), '30');
    assert.equal(capturedUrl.searchParams.get('status'), 'draft');
    // 空字符串参数应被忽略
    assert.equal(capturedUrl.searchParams.has('empty'), false);
    console.log('✓ query 参数拼装（空值忽略）');

    // --- 用例3：网关错误归一化 ---
    const c3 = new OpenApiClient({
      baseUrl: 'http://test/api/v1/open',
      apiKey: 'lmd_k3',
      fetch: async () => ({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({ code: 'RATE_LIMITED', message: '请求过于频繁' }),
      }),
    });
    return c3.listDramas().catch((err) => {
      assert.ok(err instanceof OpenApiError, '应抛出 OpenApiError');
      assert.equal(err.status, 429);
      assert.equal(err.code, 'RATE_LIMITED');
      console.log('✓ 错误归一化为 OpenApiError');
    });
  }).then(() => {
    console.log('\n全部冒烟用例通过');
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

run();
