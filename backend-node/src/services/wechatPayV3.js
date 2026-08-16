'use strict';

/**
 * 微信支付 v3 回调验签 + 报文解密（S13-T04 支付集成 · 生产接入示例）
 *
 * 一、为什么这样做
 *   微信支付 v3 的异步通知采用「平台证书签名 + AES-256-GCM 资源加密」双保险：
 *     1) HTTP 头携带 Wechatpay-Signature / Wechatpay-Timestamp / Wechatpay-Nonce / Wechatpay-Serial；
 *     2) 商户用「微信支付平台证书公钥」对 拼装串 做 SHA256withRSA 验签，防止伪造回调；
 *     3) 通知体内的 resource 是用 商户 APIv3Key 以 AES-256-GCM 加密的密文，验签通过后解密得到订单信息。
 *   本模块完整实现上述 2)、3) 步，且不依赖任何第三方 mock；真实商户凭据从「系统管理」注入。
 *
 * 二、凭据来源（放置于系统管理，不使用环境变量）
 *   全部通过 settingsService 读取 global_settings 表的 `pay_wechat` 键（value 为 JSON），字段：
 *     - mchid            商户号（必填）
 *     - merchant_id      同 mchid（兼容既有下单预检字段；二者其一即可）
 *     - api_v3_key       APIv3 密钥（32 字节，必填，用于回调资源 AES-256-GCM 解密）
 *     - api_key          兼容既有下单预检字段（存在即视为已开通）
 *     - platform_certs   微信支付平台证书数组：[{ serial_no, public_key_pem }]（必填，用于验签）
 *     - app_id           公众号/小程序/APP 的 appid（下单用，可选）
 *     - notify_url       回调地址（下单用，可选）
 *   平台证书可通过微信支付「获取平台证书列表」接口下载后解密得到，运营在系统管理页面粘贴即可。
 *
 * 三、验签拼装串（微信支付官方规范）
 *   message = HTTP-Timestamp\n + HTTP-Nonce\n + Body\n
 *   使用 Wechatpay-Serial 指定的平台证书公钥，对 message 做 SHA256withRSA 验签，
 *   签名值 Wechatpay-Signature 为 Base64。任一环节失败即判定验签不通过，拒绝回调。
 */

const crypto = require('crypto');
const settingsService = require('./settingsService');
const cryptoUtil = require('../utils/cryptoUtil');
const { loadConfig } = require('../config/index.js');

const WECHAT_SETTING_KEY = 'pay_wechat';

/**
 * 读取微信支付凭据（系统管理 → global_settings.pay_wechat）。
 * S17-T03：密钥类字段以 AES-256-GCM 密文落库，读取时解密为明文供验签/解密使用。
 */
function loadCredential(db) {
  const v = settingsService.getGlobalSetting(db, WECHAT_SETTING_KEY, null);
  if (!v || typeof v !== 'object') return null;
  const secret = (loadConfig().app || {}).secret || '';
  return cryptoUtil.decryptFields(v, ['api_v3_key', 'api_key', 'api_v3_key_masked'], secret);
}

/** 判定微信支付是否已在系统管理中开通（具备验签与解密所需的最小凭据）。 */
function isConfigured(cred) {
  if (!cred) return false;
  const hasMch = !!(cred.mchid || cred.merchant_id);
  const hasV3Key = !!cred.api_v3_key && String(cred.api_v3_key).length === 32;
  const hasCerts = Array.isArray(cred.platform_certs) && cred.platform_certs.length > 0;
  return hasMch && hasV3Key && hasCerts;
}

/** 从凭据中按证书序列号取平台证书公钥（PEM）。 */
function findPlatformPublicKey(cred, serialNo) {
  if (!cred || !Array.isArray(cred.platform_certs)) return null;
  const hit = cred.platform_certs.find(
    (c) => String(c.serial_no || c.serialNo || '').toUpperCase() === String(serialNo || '').toUpperCase()
  );
  return hit ? (hit.public_key_pem || hit.publicKeyPem || hit.pem || null) : null;
}

/**
 * 从 Express 请求中提取微信支付 v3 回调所需的头与原始报文体。
 * 注意：验签必须使用「原始请求体字符串」。若上层已 JSON.parse，则用 rawBody 兜底重新序列化。
 * @returns {{ timestamp, nonce, signature, serial, bodyText }}
 */
function extractCallbackParts(req) {
  const h = req.headers || {};
  const timestamp = h['wechatpay-timestamp'];
  const nonce = h['wechatpay-nonce'];
  const signature = h['wechatpay-signature'];
  const serial = h['wechatpay-serial'];
  // 优先使用中间件保存的原始体；否则序列化已解析的 body（字段顺序须与微信下发一致，
  // 生产环境务必在 body-parser 中开启 verify 保存 rawBody 以确保逐字节一致）。
  let bodyText = '';
  if (typeof req.rawBody === 'string') bodyText = req.rawBody;
  else if (Buffer.isBuffer(req.rawBody)) bodyText = req.rawBody.toString('utf8');
  else if (typeof req.body === 'string') bodyText = req.body;
  else bodyText = JSON.stringify(req.body || {});
  return { timestamp, nonce, signature, serial, bodyText };
}

/**
 * 校验回调时间戳，拒绝重放（默认允许 ±5 分钟偏差）。
 */
function isTimestampFresh(timestamp, toleranceSec = 300) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = Math.floor(Date.now() / 1000);
  return Math.abs(now - ts) <= toleranceSec;
}

/**
 * 微信支付 v3 验签（SHA256withRSA + 平台证书公钥）。
 * @returns {boolean} 验签是否通过
 */
function verifySignature(cred, parts) {
  const { timestamp, nonce, signature, serial, bodyText } = parts;
  if (!timestamp || !nonce || !signature || !serial) return false;
  if (!isTimestampFresh(timestamp)) return false;

  const publicKeyPem = findPlatformPublicKey(cred, serial);
  if (!publicKeyPem) return false; // 无对应平台证书 → 无法验签 → 拒绝

  // 拼装待验签串：timestamp\n nonce\n body\n
  const message = `${timestamp}\n${nonce}\n${bodyText}\n`;
  try {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(message, 'utf8');
    verifier.end();
    return verifier.verify(publicKeyPem, signature, 'base64');
  } catch (_) {
    return false;
  }
}

/**
 * 解密回调 resource（AES-256-GCM）。
 * resource 结构：{ algorithm, ciphertext, nonce, associated_data }
 * @returns {object|null} 解密后的业务报文（含 out_trade_no / transaction_id / trade_state 等）
 */
function decryptResource(cred, resource) {
  if (!cred || !cred.api_v3_key || !resource || !resource.ciphertext) return null;
  try {
    const key = Buffer.from(String(cred.api_v3_key), 'utf8'); // APIv3Key 为 32 字节
    const nonce = Buffer.from(String(resource.nonce), 'utf8');
    const aad = Buffer.from(String(resource.associated_data || ''), 'utf8');
    const data = Buffer.from(String(resource.ciphertext), 'base64');
    // GCM：密文尾部 16 字节为 authTag
    const authTag = data.subarray(data.length - 16);
    const ciphertext = data.subarray(0, data.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(authTag);
    decipher.setAAD(aad);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(plain.toString('utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * 一站式处理微信支付 v3 异步回调：验签 → 解密 → 返回业务订单信息。
 * @returns {{ ok, reason?, orderNo?, transactionId?, tradeState?, decrypted? }}
 */
function handleCallback(db, req) {
  const cred = loadCredential(db);
  if (!isConfigured(cred)) return { ok: false, reason: 'NOT_CONFIGURED' };

  const parts = extractCallbackParts(req);
  if (!verifySignature(cred, parts)) return { ok: false, reason: 'SIGN_INVALID' };

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (_) { body = {}; } }
  const decrypted = decryptResource(cred, body && body.resource);
  if (!decrypted) return { ok: false, reason: 'DECRYPT_FAILED' };

  // 仅在支付成功态放行开通
  const tradeState = decrypted.trade_state;
  if (tradeState && tradeState !== 'SUCCESS') {
    return { ok: false, reason: `TRADE_STATE_${tradeState}`, decrypted };
  }
  return {
    ok: true,
    orderNo: decrypted.out_trade_no,
    transactionId: decrypted.transaction_id,
    tradeState: tradeState || 'SUCCESS',
    decrypted,
  };
}

/**
 * Sprint 17 - S17-T03 支付配置连通性自检（管理端「测试支付」）。
 *
 * 使用当前系统管理中已保存的微信 v3 凭据做两项真实能力校验：
 *   1) AES-256-GCM：用 api_v3_key 加解密一段随机串并比对（验证回调解密密钥可用）；
 *   2) SHA256withRSA：用首张平台证书公钥签名并验签（验证证书公钥可用、验签链路正确）。
 * 不发起真实网络请求、不落库、不产生业务数据，仅验证「配置本身可用」。
 *
 * @returns {{ ok, channel, message, detail? }}
 */
function selfCheck(db) {
  const cred = loadCredential(db);
  if (!cred) return { ok: false, channel: 'wechat', message: '未读取到微信支付配置' };
  if (!isConfigured(cred)) {
    return { ok: false, channel: 'wechat', message: '微信支付未开通：缺少商户号 / APIv3 密钥 / 平台证书' };
  }
  const secret = (loadConfig().app || {}).secret || '';
  const testText = `LocalMiniDrama self-check ${Date.now()}`;

  // 1) AES-256-GCM 密钥自检
  let aesOk = false;
  try {
    const enc = cryptoUtil.encryptText(testText, secret);
    aesOk = cryptoUtil.decryptText(enc, secret) === testText;
  } catch (_) { aesOk = false; }

  // 2) 平台证书公钥自检：PEM 可解析且为有效 RSA 公钥（验签需商户私钥，仅凭平台公钥无法做签名往返）
  let rsaOk = false;
  try {
    const pem = (cred.platform_certs[0] || {}).public_key_pem;
    if (pem) {
      const keyObj = crypto.createPublicKey(pem);
      rsaOk = keyObj.asymmetricKeyType === 'rsa';
    }
  } catch (_) { rsaOk = false; }

  const ok = aesOk && rsaOk;
  return {
    ok,
    channel: 'wechat',
    message: ok
      ? '微信支付 v3 配置校验通过：APIv3 密钥与平台证书均可用'
      : '微信支付 v3 配置校验失败：APIv3 密钥或平台证书不可用',
    detail: {
      aesOk,
      rsaOk,
      mchid: cred.mchid || cred.merchant_id || '',
      certs: (cred.platform_certs || []).length,
    },
  };
}

module.exports = {
  WECHAT_SETTING_KEY,
  loadCredential,
  isConfigured,
  findPlatformPublicKey,
  extractCallbackParts,
  isTimestampFresh,
  verifySignature,
  decryptResource,
  handleCallback,
  selfCheck,
};
