'use strict';

/**
 * s8CdnFixes.test.js
 * Sprint 8 P1 CDN 风险修复专项单元测试
 *
 * 覆盖范围:
 *   R10: CDN配置缓存(模块级单例) + 基于mtime热更新
 *   R11: URL签名(HMAC-SHA256)与verifySignedUrl正确性；非法签名被拒
 *   R12: rewriteObjectUrls 循环引用深度防护不栈溢出
 *   R13: rewriteUrl() 根据 Accept: image/webp + enable_webp 协商WebP；w/h钳制
 *
 * 运行: node --test test/s8CdnFixes.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');

const cdnService = require('../src/services/cdnService.js');

/**
 * 测试用工具：临时把CDN单例配置"强制"为某个值（getCdnConfig返回的就是_cdnCfgCached引用）
 * 用完务必恢复orig，避免污染其它测试。
 */
function withPatchedConfig(patch, fn) {
  // 先确保_cdnCfgCached已初始化
  cdnService.getCdnConfig();
  const orig = cdnService.getCdnConfig();
  const saved = { ...orig };
  try {
    Object.assign(orig, patch);
    return fn(orig);
  } finally {
    // 恢复原字段值（保留引用）
    for (const k of Object.keys(orig)) delete orig[k];
    Object.assign(orig, saved);
  }
}

/* =========================================================================
 * R13: WebP 协商 + w/h 钳制
 * ========================================================================= */
describe('P1-R13: rewriteUrl WebP 协商 + 维度钳制', () => {
  test('R13a: Accept含image/webp + config enable_webp=true → 自动追加 f=webp', () => {
    withPatchedConfig({ enabled: true, base_url: 'https://cdn.example.com', enable_webp: true }, () => {
      const r1 = cdnService.rewriteUrl('/static/a.png', { accept: 'image/avif,image/webp,image/*,*/*' });
      assert.ok(r1.includes('f=webp'), `Accept含image/webp且enable_webp=true, 必须带f=webp。actual=${r1}`);
    });
  });

  test('R13b: format=webp 强指定 → 无条件追加 f=webp', () => {
    withPatchedConfig({ enabled: true, base_url: 'https://cdn.example.com', enable_webp: false }, () => {
      // 即使enable_webp=false，显式format:webp也应生效
      const u = cdnService.rewriteUrl('/static/x.jpg', { format: 'webp' });
      assert.ok(u.includes('f=webp'), 'format:webp强指定必须带f=webp。actual=' + u);
    });
  });

  test('R13c: Accept不含image/webp且未显式format → 不应追加f=webp', () => {
    withPatchedConfig({ enabled: true, base_url: 'https://cdn.example.com', enable_webp: true }, () => {
      const u = cdnService.rewriteUrl('/static/x.jpg', { accept: 'image/png,image/jpeg' });
      assert.ok(!/[?&]f=webp/.test(u), 'Accept不含webp，不应自动追加。actual=' + u);
    });
  });

  test('R13d: 负数width / NaN → 被跳过；height巨值 → 被钳制到 max_dim', () => {
    withPatchedConfig({ enabled: true, base_url: 'https://cdn.example.com', max_dim: 4096 }, () => {
      const u = cdnService.rewriteUrl('/static/x.jpg', { width: -10, height: 1e9 });
      assert.ok(!/[?&]w=/.test(u), '负数width必须被过滤。actual=' + u);
      const m = u.match(/[?&]h=(\d+)/);
      assert.ok(m, '正值height必须存在');
      assert.ok(Number(m[1]) === 4096, `height超max_dim=4096必须被钳制到4096，actual=${m[1]}`);
    });
  });

  test('R13e: CDN disabled → rewriteUrl返回原url（本地直连降级）', () => {
    withPatchedConfig({ enabled: false, base_url: '' }, () => {
      const u = cdnService.rewriteUrl('/static/x.jpg', { width: 100, format: 'webp' });
      assert.strictEqual(u, '/static/x.jpg', '未启用CDN必须原样返回，不能追加任何参数');
    });
  });
});

/* =========================================================================
 * R11: URL签名 与 验证
 * ========================================================================= */
describe('P1-R11: CDN URL 签名 (HMAC-SHA256 + expires)', () => {
  const T_SECRET = 'test-secret-only-for-unit-test-do-not-commit';

  test('R11a: signUrl 后 → verifySignedUrl 必过', () => {
    const signed = cdnService.signUrl('https://cdn.example.com/a/b.png', T_SECRET);
    assert.ok(signed.includes('sig='), 'sig参数缺失（注意不是sign）');
    assert.ok(signed.includes('expires='), 'expires参数缺失');
    const result = cdnService.verifySignedUrl(signed, T_SECRET);
    assert.ok(result.ok, `自签URL必须通过校验。signed=${signed} result=${JSON.stringify(result)}`);
    assert.strictEqual(result.reason, 'verified');
  });

  test('R11b: 篡改 query 参数 → verify失败 (防篡改expires/其他字段)', () => {
    const signed = cdnService.signUrl('https://cdn.example.com/x.png?w=200', T_SECRET, 3600);
    // 篡改 expires 字段：把末尾的 expires 时间戳+1
    const tampered = signed.replace(/expires=(\d+)/, (m, e) => `expires=${Number(e) + 1000}`);
    const result = cdnService.verifySignedUrl(tampered, T_SECRET);
    assert.strictEqual(result.ok, false,
      `expires被篡改后必须验证失败，actual=${JSON.stringify(result)}`);
    assert.strictEqual(result.reason, 'bad signature');
  });

  test('R11c: 过期URL → verify=false (防盗刷过期)', () => {
    const signed = cdnService.signUrl('https://cdn.example.com/x.png', T_SECRET, -1);
    const result = cdnService.verifySignedUrl(signed, T_SECRET);
    assert.strictEqual(result.ok, false,
      `过期expires必须验证失败，actual=${JSON.stringify(result)}`);
    assert.strictEqual(result.reason, 'expired');
  });

  test('R11d: sig缺失/被篡改 → bad signature；未签名原始URL → ok=true（兼容历史链接）', () => {
    // 仅expires，缺sig → ok=true（视作未签名，兼容历史原始链接）
    const urlNoSig = 'https://cdn.example.com/x.png?expires=' + (Math.floor(Date.now()/1000)+3600);
    const rNoSig = cdnService.verifySignedUrl(urlNoSig, T_SECRET);
    assert.strictEqual(rNoSig.ok, true, '未携sig的"类签名"链接，兼容模式返回ok:true（不硬拦截）');
    assert.ok(rNoSig.reason.startsWith('unsigned'), `reason应标记unsigned，actual=${rNoSig.reason}`);

    // sig被篡改 → ok=false, bad signature
    const signed = cdnService.signUrl('https://cdn.example.com/x.png', T_SECRET, 3600);
    const tampered = signed.replace(/sig=[0-9a-f]{16}/, 'sig=' + 'a'.repeat(16));
    const rTampered = cdnService.verifySignedUrl(tampered, T_SECRET);
    assert.strictEqual(rTampered.ok, false, 'sig被改必须失败');
    assert.strictEqual(rTampered.reason, 'bad signature');
  });

  test('R11e: rewriteUrl() 当enable_signature=true时，自动为输出URL加签名，且verify通过', () => {
    withPatchedConfig({
      enabled: true,
      base_url: 'https://cdn.example.com',
      enable_signature: true,
      signature_secret: T_SECRET,
      signature_ttl_sec: 3600,
    }, () => {
      const u = cdnService.rewriteUrl('/static/x.png');
      assert.ok(u.includes('sig='), 'enable_signature=true, rewriteUrl必须加sig。actual=' + u);
      const result = cdnService.verifySignedUrl(u, T_SECRET);
      assert.ok(result.ok,
        `rewriteUrl签的必须verify通过。u=${u} result=${JSON.stringify(result)}`);
    });
  });
});

/* =========================================================================
 * R12: 循环引用防护（rewriteObjectUrls）
 * ========================================================================= */
describe('P1-R12: 循环引用 & 深嵌套保护 (不栈溢出/不无限递归)', () => {
  test('R12a: 处理自循环对象 → 不栈溢出', () => {
    withPatchedConfig({ enabled: false }, () => {
      const a = { cover_url: '/static/a.png', covers: { thumb_url: '/static/t1.png' } };
      const b = { cover_url: '/static/b.png', covers: { thumb_url: '/static/t2.png' } };
      a.friend = b; b.friend = a;
      // 深嵌套链表 500 层
      let deep = { cover_url: '/static/deep.png' };
      let cur = deep;
      for (let i = 0; i < 500; i++) { cur.next = { cover_url: `/static/d${i}.png` }; cur = cur.next; }
      a._deepHolder = deep;

      let threw = null;
      try {
        const rewrote = cdnService.rewriteObjectUrls(a);
        assert.ok(rewrote.cover_url, 'a.cover_url应保留');
        assert.ok(rewrote.covers.thumb_url, '嵌套covers.thumb_url应保留');
      } catch (e) {
        threw = e;
      }
      assert.strictEqual(threw, null,
        `R12循环引用/深嵌套对象处理时抛出异常: ${threw && threw.message}`);
    });
  });

  test('R12b: 数组字段中的URL也被替换', () => {
    withPatchedConfig({ enabled: true, base_url: 'https://cdn.example.com' }, () => {
      const obj = {
        items: [
          { cover_url: '/static/a.png' },
          { cover_url: '/static/b.png' },
          { nested: [{ cover_url: '/static/c.png' }] },
        ],
      };
      const r = cdnService.rewriteObjectUrls(obj, { w: 100 });
      assert.ok(r.items[0].cover_url.startsWith('https://cdn.example.com/static/a.png'),
        '数组内的cover_url必须被重写，actual=' + r.items[0].cover_url);
      assert.ok(r.items[2].nested[0].cover_url.startsWith('https://cdn.example.com/'),
        '嵌套数组内的cover_url必须被重写');
    });
  });

  test('R12c: 非字符串/URL值保持原样', () => {
    withPatchedConfig({ enabled: false }, () => {
      const obj = { title: '名字', num: 42, arr: [1,2], nully: null, bool: true };
      const r = cdnService.rewriteObjectUrls(obj);
      assert.strictEqual(r.title, '名字');
      assert.strictEqual(r.num, 42);
      assert.deepStrictEqual(r.arr, [1,2]);
      assert.strictEqual(r.nully, null);
      assert.strictEqual(r.bool, true);
    });
  });
});

/* =========================================================================
 * R10: CDN配置缓存 + mtime热更新
 * ========================================================================= */
describe('P1-R10: CDN配置缓存(单例) + mtime热更新', () => {
  test('R10a: getCdnConfig() 连续多次调用返回同一对象引用（单例）', () => {
    // 先初始化一次
    cdnService.getCdnConfig();
    const a = cdnService.getCdnConfig();
    const b = cdnService.getCdnConfig();
    assert.ok(a === b, 'getCdnConfig必须返回同一引用(模块级单例缓存)');
    assert.ok(typeof a === 'object' && a !== null);
  });

  test('R10b: 直接修改返回对象 → getCdnConfig()立即看到新值（热生效）', () => {
    cdnService.getCdnConfig();
    const cfg = cdnService.getCdnConfig();
    const origMax = cfg.max_dim;
    const origWebp = cfg.enable_webp;
    try {
      cfg.max_dim = 9999;
      cfg.enable_webp = !cfg.enable_webp;
      const now = cdnService.getCdnConfig();
      assert.strictEqual(now.max_dim, 9999, '修改引用后立即看到新max_dim');
      assert.strictEqual(now.enable_webp, !origWebp, '修改引用后立即看到新enable_webp');
    } finally {
      cfg.max_dim = origMax;
      cfg.enable_webp = origWebp;
    }
  });

  test('R10c: _invalidateConfigCache → 下次getCdnConfig会重新解析', () => {
    cdnService.getCdnConfig();
    const before = cdnService._configCacheMeta();
    cdnService._invalidateConfigCache();
    // 重新get一次后，cached应再次为true（即使没yaml文件，fallback也会缓存）
    cdnService.getCdnConfig();
    const after = cdnService._configCacheMeta();
    assert.strictEqual(after.cached, true, 'invalidate后再get一次必须回到cached=true');
    assert.ok(after.access_count > before.access_count, 'access_count应递增');
  });

  test('R10d: getCdnConfig 包含 R10~R13 新增字段', () => {
    const c = cdnService.getCdnConfig();
    assert.ok('enable_webp' in c, '缺少R13字段: enable_webp');
    assert.ok('max_dim' in c, '缺少R13字段: max_dim');
    assert.ok('enable_signature' in c, '缺少R11字段: enable_signature');
    assert.ok('signature_secret' in c, '缺少R11字段: signature_secret');
    assert.ok('signature_ttl_sec' in c, '缺少R11字段: signature_ttl_sec');
  });
});
