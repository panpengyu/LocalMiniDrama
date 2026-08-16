'use strict';

/**
 * Sprint 17 - S17-T03 支付配置加密存储工具
 *
 * 采用 AES-256-GCM（认证加密）对支付密钥类配置做落库加密：
 *   - 密文统一以 `ENC:v1:` 前缀标识，明文保持原样（兼容既有存量数据）；
 *   - 密钥派生：SHA-256(app.secret)，密钥长度恒为 32 字节；
 *   - GCM 带认证标签，篡改密文会导致解密失败（安全起见上层应视为不可用）。
 *
 * 编码说明：密文使用 **hex 编码**（仅 0-9a-f）。实测 sync-mysql 驱动对含 base64
 * 特殊字符（+ / 等）的参数绑定存在缺陷，写入会被截断（S17-T03 复现）；hex 编码
 * 为纯字母数字，可安全落库。
 *
 * 使用场景：
 *   - routes/settings.js  保存支付凭据时对 api_v3_key / 平台证书公钥 / 支付宝密钥加密；
 *   - wechatPayV3.js      读取凭据时解密为明文供验签与解密使用；
 *   - routes/settings.js  脱敏视图识别 ENC 前缀，避免回显密文。
 */

const crypto = require('crypto');

const PREFIX = 'ENC:v1:';

function deriveKey(secret) {
  return crypto.createHash('sha256')
    .update(String(secret || 'LocalMiniDrama#default-secret#2026'))
    .digest();
}

/** 加密字符串；空值原样返回。密文为 hex 编码（兼容 sync-mysql 参数绑定）。 */
function encryptText(plain, secret) {
  if (plain === undefined || plain === null || plain === '') return plain;
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('hex');
}

/** 解密字符串；无 ENC 前缀或解密失败时原样返回（兼容旧明文数据）。 */
function decryptText(value, secret) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) return value;
  try {
    const raw = Buffer.from(value.slice(PREFIX.length), 'hex');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (_) {
    return value;
  }
}

/** 是否密文（含 ENC 前缀）。 */
function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** 对象中指定字段逐一加密（返回新对象；platform_certs 数组内 public_key_pem 一并处理）。 */
function encryptFields(obj, fields, secret) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const f of fields) {
    if (out[f] !== undefined) out[f] = encryptText(out[f], secret);
  }
  if (Array.isArray(out.platform_certs)) {
    out.platform_certs = out.platform_certs.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const cp = { ...c };
      if (cp.public_key_pem !== undefined) cp.public_key_pem = encryptText(cp.public_key_pem, secret);
      return cp;
    });
  }
  return out;
}

/** 对象中指定字段逐一解密（返回新对象）。 */
function decryptFields(obj, fields, secret) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = { ...obj };
  for (const f of fields) {
    if (out[f] !== undefined) out[f] = decryptText(out[f], secret);
  }
  if (Array.isArray(out.platform_certs)) {
    out.platform_certs = out.platform_certs.map((c) => {
      if (!c || typeof c !== 'object') return c;
      const cp = { ...c };
      if (cp.public_key_pem !== undefined) cp.public_key_pem = decryptText(cp.public_key_pem, secret);
      return cp;
    });
  }
  return out;
}

module.exports = {
  PREFIX,
  encryptText,
  decryptText,
  isEncrypted,
  encryptFields,
  decryptFields,
};
