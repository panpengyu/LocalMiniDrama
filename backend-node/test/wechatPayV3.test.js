'use strict';

/**
 * S13-T04 微信支付 v3 验签 + 资源解密 单元测试
 *
 * 全程使用 Node 原生 crypto 生成真实 RSA 密钥对与 AES-256-GCM 密文，
 * 验证 wechatPayV3 的验签/解密逻辑正确（真实密码学运算，无 mock）：
 *   - 用平台私钥对「timestamp\n nonce\n body\n」签名 → verifySignature 通过；
 *   - 篡改 body / 过期时间戳 / 错误证书序列号 → 验签失败；
 *   - AES-256-GCM 加密 resource → decryptResource 正确还原订单信息；
 *   - handleCallback 端到端：凭据取自内存 fake settings（模拟 global_settings 读取）。
 */

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const wechatPayV3 = require('../src/services/wechatPayV3');

// 生成一对 RSA 密钥模拟「微信支付平台证书」私钥/公钥
function genKeyPair() {
  return crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

// 用平台私钥对 message 做 SHA256withRSA 签名（模拟微信下发的 Wechatpay-Signature）
function sign(privateKey, message) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(message, 'utf8');
  signer.end();
  return signer.sign(privateKey, 'base64');
}

// AES-256-GCM 加密（模拟微信下发的 resource 密文）
function encryptResource(apiV3Key, plainObj, aad = 'transaction') {
  const nonce = crypto.randomBytes(12).toString('hex').slice(0, 12); // 12 字符
  const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(aad));
  const enc = Buffer.concat([cipher.update(JSON.stringify(plainObj), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertext = Buffer.concat([enc, authTag]).toString('base64');
  return { algorithm: 'AEAD_AES_256_GCM', ciphertext, nonce, associated_data: aad };
}

const SERIAL = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
const API_V3_KEY = '01234567890123456789012345678901'; // 32 字节

test('S13-T04 微信支付 v3：真实签名验签通过', () => {
  const { publicKey, privateKey } = genKeyPair();
  const cred = {
    mchid: '1600000001',
    api_v3_key: API_V3_KEY,
    platform_certs: [{ serial_no: SERIAL, public_key_pem: publicKey }],
  };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'test-nonce-123';
  const bodyText = JSON.stringify({ id: 'evt_1', event_type: 'TRANSACTION.SUCCESS' });
  const message = `${timestamp}\n${nonce}\n${bodyText}\n`;
  const signature = sign(privateKey, message);

  const ok = wechatPayV3.verifySignature(cred, { timestamp, nonce, signature, serial: SERIAL, bodyText });
  assert.strictEqual(ok, true, '正确签名应验签通过');
});

test('S13-T04 微信支付 v3：篡改报文体验签失败', () => {
  const { publicKey, privateKey } = genKeyPair();
  const cred = { mchid: '1600000001', api_v3_key: API_V3_KEY, platform_certs: [{ serial_no: SERIAL, public_key_pem: publicKey }] };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'nonce-x';
  const message = `${timestamp}\n${nonce}\n${JSON.stringify({ a: 1 })}\n`;
  const signature = sign(privateKey, message);
  // 用被篡改的 body 验签
  const ok = wechatPayV3.verifySignature(cred, { timestamp, nonce, signature, serial: SERIAL, bodyText: JSON.stringify({ a: 2 }) });
  assert.strictEqual(ok, false, '报文被篡改应验签失败');
});

test('S13-T04 微信支付 v3：过期时间戳被拒绝', () => {
  const { publicKey, privateKey } = genKeyPair();
  const cred = { mchid: '1600000001', api_v3_key: API_V3_KEY, platform_certs: [{ serial_no: SERIAL, public_key_pem: publicKey }] };
  const timestamp = String(Math.floor(Date.now() / 1000) - 3600); // 1小时前
  const nonce = 'nonce-old';
  const bodyText = JSON.stringify({ a: 1 });
  const signature = sign(privateKey, `${timestamp}\n${nonce}\n${bodyText}\n`);
  const ok = wechatPayV3.verifySignature(cred, { timestamp, nonce, signature, serial: SERIAL, bodyText });
  assert.strictEqual(ok, false, '超出容差的时间戳应被拒绝（防重放）');
});

test('S13-T04 微信支付 v3：未知证书序列号验签失败', () => {
  const { publicKey, privateKey } = genKeyPair();
  const cred = { mchid: '1600000001', api_v3_key: API_V3_KEY, platform_certs: [{ serial_no: SERIAL, public_key_pem: publicKey }] };
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = 'n';
  const bodyText = '{}';
  const signature = sign(privateKey, `${timestamp}\n${nonce}\n${bodyText}\n`);
  const ok = wechatPayV3.verifySignature(cred, { timestamp, nonce, signature, serial: 'UNKNOWN_SERIAL', bodyText });
  assert.strictEqual(ok, false, '找不到对应平台证书应验签失败');
});

test('S13-T04 微信支付 v3：AES-256-GCM 资源解密正确还原', () => {
  const cred = { api_v3_key: API_V3_KEY };
  const payload = { out_trade_no: 'MO20260812XXYY', transaction_id: '42000012345', trade_state: 'SUCCESS', amount: { total: 9900 } };
  const resource = encryptResource(API_V3_KEY, payload);
  const decrypted = wechatPayV3.decryptResource(cred, resource);
  assert.ok(decrypted, '应成功解密');
  assert.strictEqual(decrypted.out_trade_no, 'MO20260812XXYY');
  assert.strictEqual(decrypted.trade_state, 'SUCCESS');
});

test('S13-T04 微信支付 v3：handleCallback 端到端验签+解密', () => {
  const { publicKey, privateKey } = genKeyPair();
  const cred = {
    mchid: '1600000001',
    api_v3_key: API_V3_KEY,
    platform_certs: [{ serial_no: SERIAL, public_key_pem: publicKey }],
  };
  // fake db.settings：模拟 settingsService.getGlobalSetting 读取 global_settings
  const settingsService = require('../src/services/settingsService');
  const origGet = settingsService.getGlobalSetting;
  settingsService.getGlobalSetting = (db, key) => (key === 'pay_wechat' ? cred : null);
  try {
    const payload = { out_trade_no: 'MO_E2E_001', transaction_id: 'TX_E2E', trade_state: 'SUCCESS' };
    const resource = encryptResource(API_V3_KEY, payload);
    const body = { id: 'evt', event_type: 'TRANSACTION.SUCCESS', resource };
    const bodyText = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = 'e2e-nonce';
    const signature = sign(privateKey, `${timestamp}\n${nonce}\n${bodyText}\n`);
    const req = {
      headers: {
        'wechatpay-timestamp': timestamp,
        'wechatpay-nonce': nonce,
        'wechatpay-signature': signature,
        'wechatpay-serial': SERIAL,
      },
      rawBody: bodyText,
      body,
    };
    const r = wechatPayV3.handleCallback({}, req);
    assert.strictEqual(r.ok, true, '端到端应通过');
    assert.strictEqual(r.orderNo, 'MO_E2E_001');
    assert.strictEqual(r.transactionId, 'TX_E2E');
  } finally {
    settingsService.getGlobalSetting = origGet;
  }
});

test('S13-T04 微信支付 v3：未配置凭据时 handleCallback 拒绝', () => {
  const settingsService = require('../src/services/settingsService');
  const origGet = settingsService.getGlobalSetting;
  settingsService.getGlobalSetting = () => null;
  try {
    const r = wechatPayV3.handleCallback({}, { headers: {}, body: {} });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'NOT_CONFIGURED');
  } finally {
    settingsService.getGlobalSetting = origGet;
  }
});
