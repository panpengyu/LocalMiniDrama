'use strict';

/**
 * Sprint 17 - S17-T06 支付宝支付服务
 *
 * 基于官方 alipay-sdk（^4.14.0）封装会员套餐支付能力：
 *   - 统一下单：alipay.trade.page.pay（电脑网站支付，支持沙箱网关）
 *   - 回调验签：checkNotifySignV2（RSA2，未解码原始参数验签）
 *   - 退款：alipay.trade.refund（真实调用开放平台）
 *   - selfCheck：本地生成并回验签名，验证凭据可用性（不依赖外部网络）
 *
 * 凭据读取：global_settings.pay_alipay（S17-T03 AES-256-GCM 加密存储），
 * 字段：merchant_id / app_id / notify_url / api_key(应用私钥) / alipay_public_key / sandbox。
 */

const { AlipaySdk } = require('alipay-sdk');
const settingsService = require('./settingsService');
const cryptoUtil = require('../utils/cryptoUtil');
const { loadConfig } = require('../config');

const GATEWAY_PROD = 'https://openapi.alipay.com/gateway.do';
const GATEWAY_SANDBOX = 'https://openapi.alipaydev.com/gateway.do';

/** 获取加密密钥（与 settings.js 保存凭据时使用同一密钥）。 */
function getSecret() {
  return (loadConfig().app || {}).secret || 'LocalMiniDrama#default-secret#2026';
}

/**
 * 读取并解密支付宝商户凭据。
 * @returns {object|null} { merchant_id, app_id, notify_url, api_key(明文), alipay_public_key(明文), sandbox, gateway }
 */
function loadCredential(db) {
  const raw = settingsService.getGlobalSetting(db, 'pay_alipay', null);
  if (!raw || typeof raw !== 'object') return null;
  const secret = getSecret();
  const cred = {
    merchant_id: raw.merchant_id || '',
    app_id: raw.app_id || '',
    notify_url: raw.notify_url || '',
    api_key: cryptoUtil.decryptText(raw.api_key, secret),
    alipay_public_key: cryptoUtil.decryptText(raw.alipay_public_key, secret),
    sandbox: !!raw.sandbox,
  };
  cred.gateway = cred.sandbox ? GATEWAY_SANDBOX : GATEWAY_PROD;
  return cred;
}

/** 是否已配置且可用于真实支付。 */
function isConfigured(cred) {
  return !!(
    cred &&
    cred.app_id &&
    cred.api_key &&
    cred.alipay_public_key &&
    cred.merchant_id
  );
}

/** 创建 AlipaySdk 实例。 */
function createSdk(cred) {
  return new AlipaySdk({
    appId: cred.app_id,
    privateKey: cred.api_key,
    alipayPublicKey: cred.alipay_public_key,
    signType: 'RSA2',
    keyType: 'PKCS8',
    gateway: cred.gateway,
    timeout: 15000,
  });
}

/**
 * 统一下单（电脑网站支付 alipay.trade.page.pay）。
 * 返回 sdkParams（签名后的支付串）与 pay_url（可直接跳转的收银台地址）。
 * 金额以「元」为单位，两位小数。
 */
function createPagePay(db, order, { returnUrl } = {}) {
  const cred = loadCredential(db);
  if (!isConfigured(cred)) {
    const err = new Error('支付宝商户凭据未配置或无效，请先在「支付配置」中完善支付宝信息');
    err.code = 'ALIPAY_NOT_CONFIGURED';
    throw err;
  }
  const sdk = createSdk(cred);
  const bizContent = {
    out_trade_no: order.order_no,
    product_code: 'FAST_INSTANT_TRADE_PAY',
    total_amount: Number(order.amount).toFixed(2),
    subject: `会员购买-${order.level_code || 'member'}`,
    timeout_express: '2h',
  };
  const sdkParams = sdk.sdkExecute('alipay.trade.page.pay', {
    bizContent,
    notify_url: cred.notify_url,
    return_url: returnUrl || cred.notify_url || '',
  });
  return {
    sdkParams,
    pay_url: `${cred.gateway}?${sdkParams}`,
    gateway: cred.gateway,
    sandbox: cred.sandbox,
  };
}

/**
 * 生成可自动提交的 HTML 支付表单（pageExec）。
 * 适用于前端 iframe/新窗口渲染收银台。
 */
function createPagePayForm(db, order, { returnUrl } = {}) {
  const cred = loadCredential(db);
  if (!isConfigured(cred)) {
    const err = new Error('支付宝商户凭据未配置或无效，请先在「支付配置」中完善支付宝信息');
    err.code = 'ALIPAY_NOT_CONFIGURED';
    throw err;
  }
  const sdk = createSdk(cred);
  const form = sdk.pageExec('alipay.trade.page.pay', 'POST', {
    bizContent: {
      out_trade_no: order.order_no,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: Number(order.amount).toFixed(2),
      subject: `会员购买-${order.level_code || 'member'}`,
      timeout_express: '2h',
    },
    notify_url: cred.notify_url,
    return_url: returnUrl || cred.notify_url || '',
  });
  return form;
}

/**
 * 回调验签（checkNotifySignV2）。
 * 支付宝回调为 form-urlencoded，sign 基于「未解码」参数拼接；上层应传入
 * 保留原始编码的参数对象（由 express 的 verify 中间件保存 rawBody 后解析）。
 * @param {object} db 数据库实例
 * @param {object} postData 原始参数（value 保持 URL 编码态）
 * @returns {boolean}
 */
function verifyNotify(db, postData) {
  if (!postData || typeof postData !== 'object' || !postData.sign) return false;
  const cred = loadCredential(db);
  if (!isConfigured(cred)) return false;
  try {
    return createSdk(cred).checkNotifySignV2(postData);
  } catch (_) {
    return false;
  }
}

/**
 * 退款（alipay.trade.refund）。
 * @param {object} db 数据库实例
 * @param {object} order 订单（order_no / amount）
 * @param {object} opts { reason, outRequestNo }
 * @returns {Promise<{ok, code, msg, refundTradeNo}>}
 */
async function refund(db, order, opts = {}) {
  const cred = loadCredential(db);
  if (!isConfigured(cred)) {
    return { ok: false, code: 'ALIPAY_NOT_CONFIGURED', msg: '支付宝商户凭据未配置，无法发起退款' };
  }
  const sdk = createSdk(cred);
  const bizContent = {
    out_trade_no: order.order_no,
    refund_amount: Number(order.amount).toFixed(2),
    refund_reason: opts.reason || '管理端订单退款',
    out_request_no: opts.outRequestNo || `${order.order_no}R`,
  };
  try {
    const resp = await sdk.exec('alipay.trade.refund', { bizContent });
    const r = resp && (resp.alipayTradeRefundResponse || resp.alipay_trade_refund_response || {});
    if (r.code === '10000') {
      return { ok: true, code: r.code, msg: r.msg || 'Success', refundTradeNo: r.trade_no || '' };
    }
    return { ok: false, code: r.code, msg: r.sub_msg || r.msg || '退款失败' };
  } catch (e) {
    return { ok: false, code: 'ALIPAY_REFUND_ERROR', msg: e.message };
  }
}

/**
 * 支付自检（sandbox/正式通用）：
 * 用已配置密钥本地生成一笔「支付串」并回验签名，验证 SDK、密钥、网关配置链路可用。
 * 不发起真实支付、不产生真实交易。
 */
function selfCheck(db) {
  const cred = loadCredential(db);
  if (!isConfigured(cred)) {
    return {
      configured: false,
      sandbox: !!(cred && cred.sandbox),
      gateway: cred ? cred.gateway : GATEWAY_PROD,
      message: '支付宝未配置完整（需 merchant_id / app_id / api_key / alipay_public_key）',
    };
  }
  try {
    const sdk = createSdk(cred);
    const bizContent = {
      out_trade_no: `SELFCHECK${Date.now()}`,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: '0.01',
      subject: '自检',
    };
    const sdkParams = sdk.sdkExecute('alipay.trade.page.pay', { bizContent });
    // 回验：将支付串解析为原始参数对象后验签，确保私钥/公钥/网关链路自洽
    const postData = {};
    for (const kv of sdkParams.split('&')) {
      const idx = kv.indexOf('=');
      if (idx > 0) postData[kv.slice(0, idx)] = kv.slice(idx + 1);
    }
    const verified = sdk.checkNotifySignV2(postData);
    return {
      configured: true,
      sandbox: cred.sandbox,
      gateway: cred.gateway,
      app_id: cred.app_id,
      merchant_id: cred.merchant_id,
      notify_url: cred.notify_url,
      sign_verified: verified,
      message: verified
        ? '支付宝配置正常：SDK 加载成功，RSA2 签名自检通过'
        : '支付宝签名自检未通过，请检查 api_key / alipay_public_key 是否匹配',
    };
  } catch (e) {
    return {
      configured: true,
      sandbox: cred.sandbox,
      gateway: cred.gateway,
      error: e.message,
      message: `支付宝自检异常：${e.message}`,
    };
  }
}

module.exports = {
  GATEWAY_PROD,
  GATEWAY_SANDBOX,
  loadCredential,
  isConfigured,
  createSdk,
  createPagePay,
  createPagePayForm,
  verifyNotify,
  refund,
  selfCheck,
};
