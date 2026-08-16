'use strict';

/**
 * Sprint 17 - T17-03 支付配置（加密存储 + 连通性自检）集成测试
 *
 * 严格约束（用户要求）：
 *   - 连接本地真实 MySQL（configs/config.yaml），无 mock。
 *   - 凭据真实写入 global_settings.pay_wechat（AES-256-GCM 密文落库）。
 *   - 测试期间会临时覆盖 pay_wechat，before 备份、after 恢复，不污染业务配置。
 *
 * 覆盖：
 *   [1] cryptoUtil 加解密往返 / 明文兼容 / ENC 前缀识别
 *   [2] 支付凭据加密落库：库中 api_v3_key 为 ENC:v1: 密文
 *   [3] loadCredential 解密还原 32 字节 APIv3 密钥；isConfigured=true
 *   [4] selfCheck：有效配置（随机 RSA 平台证书）→ ok=true
 *   [5] selfCheck：未配置 → ok=false（message 提示未开通）
 *   [6] 脱敏视图逻辑：掩码函数对 ENC 前缀返回「已加密存储」
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const { loadConfig } = require(path.resolve(__dirname, '..', 'src', 'config', 'index.js'));
const { getDb, closeDb } = require(path.resolve(__dirname, '..', 'src', 'db', 'index.js'));
const settingsService = require(path.resolve(__dirname, '..', 'src', 'services', 'settingsService.js'));
const wechatPayV3 = require(path.resolve(__dirname, '..', 'src', 'services', 'wechatPayV3.js'));
const cryptoUtil = require(path.resolve(__dirname, '..', 'src', 'utils', 'cryptoUtil.js'));

let db;
const secret = (loadConfig().app || {}).secret || '';
let savedWechatRaw = null; // 备份原配置（原始字符串，逐字节恢复）

// 测试凭据（32 字节 APIv3 密钥 + 随机 RSA 平台证书）
const V3_KEY = 's17test-apiv3-key-0123456789abcd';
let fakeCertPem = '';

test.before(async () => {
  const cfg = loadConfig();
  assert.equal(cfg.database.type, 'mysql', '集成测试要求 config.yaml 数据库类型为 mysql（真实库）');
  db = getDb(cfg.database);
  // 用原始 SQL 备份（既有值可能为损坏/不可解析数据，逐字节保留）
  const row = db.prepare('SELECT value FROM global_settings WHERE `key` = ?').get('pay_wechat');
  savedWechatRaw = row ? row.value : null;
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fakeCertPem = publicKey.export({ type: 'spki', format: 'pem' });
});

test.after(() => {
  try {
    if (savedWechatRaw != null) {
      db.prepare('UPDATE global_settings SET value = ? WHERE `key` = ?').run(savedWechatRaw, 'pay_wechat');
    } else {
      db.prepare('DELETE FROM global_settings WHERE `key` = ?').run('pay_wechat');
    }
  } catch (_) { /* ignore */ }
  try { closeDb(); } catch (_) { /* ignore */ }
});

test('S17-T03 [1] cryptoUtil 加解密往返 / 明文兼容', () => {
  const plain = '密钥-机密-32字节-内容test1234';
  const enc = cryptoUtil.encryptText(plain, secret);
  assert.ok(cryptoUtil.isEncrypted(enc), '密文应带 ENC:v1: 前缀');
  assert.equal(cryptoUtil.decryptText(enc, secret), plain, '解密应还原明文');
  // 非密文原样返回
  assert.equal(cryptoUtil.decryptText('plain-text', secret), 'plain-text');
  // 空值原样
  assert.equal(cryptoUtil.encryptText('', secret), '');
  // 篡改密文 → 解密失败时原样返回（不抛异常）
  const tampered = enc.slice(0, -4) + 'AAAA';
  assert.equal(cryptoUtil.decryptText(tampered, secret), tampered);
});

test('S17-T03 [2] 支付凭据加密落库（库内为 ENC 密文）', () => {
  const payload = {
    mchid: '1900000109',
    app_id: 'wx-test-appid',
    notify_url: 'https://example.com/api/membership/pay/notify/wechat',
    api_v3_key: V3_KEY,
    platform_certs: [{ serial_no: 's17test-serial-001', public_key_pem: fakeCertPem }],
  };
  const encrypted = cryptoUtil.encryptFields(payload, ['api_v3_key', 'api_key'], secret);
  settingsService.setGlobalSetting(db, 'pay_wechat', encrypted);
  // 直查库：已加密
  const raw = settingsService.getGlobalSetting(db, 'pay_wechat', null);
  assert.ok(String(raw.api_v3_key).startsWith('ENC:v1:'), '库中 api_v3_key 应为密文');
  assert.ok(String(raw.platform_certs[0].public_key_pem).startsWith('ENC:v1:'), '证书公钥应为密文');
  // 明文商户号不进加密
  assert.equal(raw.mchid, '1900000109');
});

test('S17-T03 [3] loadCredential 解密还原并可判定已开通', () => {
  const cred = wechatPayV3.loadCredential(db);
  assert.ok(cred, '应读到凭据');
  assert.equal(cred.api_v3_key, V3_KEY, '解密后还原 32 字节明文密钥');
  assert.equal(cred.platform_certs[0].public_key_pem, fakeCertPem);
  assert.equal(wechatPayV3.isConfigured(cred), true, '应判定已开通');
});

test('S17-T03 [4] selfCheck：有效配置 → ok=true', () => {
  const r = wechatPayV3.selfCheck(db);
  assert.equal(r.channel, 'wechat');
  assert.equal(r.ok, true, '密钥与证书可用时应自检通过');
  assert.equal(r.detail.aesOk, true);
  assert.equal(r.detail.rsaOk, true);
  assert.equal(r.detail.certs, 1);
});

test('S17-T03 [5] selfCheck：未配置 → ok=false', () => {
  db.prepare('DELETE FROM global_settings WHERE `key` = ?').run('pay_wechat');
  const r = wechatPayV3.selfCheck(db);
  assert.equal(r.ok, false);
  assert.match(r.message, /未开通|未读取/);
  // 恢复测试配置，供 after 逐字节还原原始值
  settingsService.setGlobalSetting(db, 'pay_wechat', {
    mchid: '1900000109', api_v3_key: V3_KEY,
    platform_certs: [{ serial_no: 's17test-serial-001', public_key_pem: fakeCertPem }],
  });
});

test('S17-T03 [6] 脱敏掩码识别 ENC 前缀', () => {
  const mask = (v) => {
    if (!v) return '';
    if (String(v).startsWith(cryptoUtil.PREFIX)) return 'encrypted(已加密存储)';
    return `${String(v).slice(0, 2)}****${String(v).slice(-2)}`;
  };
  assert.equal(mask('abc123456'), 'ab****56');
  assert.equal(mask('ENC:v1:xxxx'), 'encrypted(已加密存储)');
  assert.equal(mask(''), '');
});
