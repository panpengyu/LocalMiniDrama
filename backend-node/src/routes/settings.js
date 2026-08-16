/**
 * 设置路由模块
 * 
 * 提供系统设置相关的 API 接口，包括语言设置、生成相关设置（并发数、视频超时时间等）。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {object} 设置路由处理函数集合
 */
const settingsService = require('../services/settingsService');
const response = require('../response');
const { loadConfig } = require('../config');
const cryptoUtil = require('../utils/cryptoUtil');
const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');

/**
 * 获取系统语言设置接口
 * 
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function getLanguage(cfg) {
  return (req, res) => {
    const language = settingsService.getLanguage(cfg);
    response.success(res, { language });
  };
}

/**
 * 更新系统语言设置接口
 * 
 * 仅支持 zh（中文）和 en（英文）两种语言。
 * 
 * @param {object} cfg - 配置对象
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function updateLanguage(cfg, log) {
  return (req, res) => {
    const lang = req.body?.language;
    if (lang !== 'zh' && lang !== 'en') {
      return response.badRequest(res, '语言参数错误，只支持 zh 或 en');
    }
    const out = settingsService.updateLanguage(cfg, log, lang);
    if (!out.ok) return response.badRequest(res, out.error);
    const message = lang === 'en' ? 'Language switched to English' : '语言已切换为中文';
    response.success(res, { message, language: lang });
  };
}

/**
 * 获取生成相关设置接口
 * 
 * 返回图片并发数、视频并发数和视频生成超时时间。
 * 超级管理员获取全局设置，普通用户获取个人设置。
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function getGenerationSettings(db) {
  return (req, res) => {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'super_admin';
    const concurrency = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_concurrency', 3);
    const video_concurrency = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_video_concurrency', 3);
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, { concurrency, video_concurrency, video_generation_timeout_minutes });
  };
}

/**
 * 更新生成相关设置接口
 * 
 * 更新图片并发数和视频并发数（1-20之间的整数）。
 * 超级管理员更新全局设置，普通用户更新个人设置。
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function updateGenerationSettings(db) {
  return (req, res) => {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'super_admin';
    const { concurrency, video_concurrency } = req.body || {};
    if (concurrency !== undefined) {
      const n = Number(concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '图片并发数需为 1-20 之间的整数');
      }
      if (isAdmin) {
        settingsService.setGlobalSetting(db, 'pipeline_concurrency', n);
      } else {
        settingsService.setUserSetting(db, userId, 'pipeline_concurrency', n);
      }
    }
    if (video_concurrency !== undefined) {
      const n = Number(video_concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '视频并发数需为 1-20 之间的整数');
      }
      if (isAdmin) {
        settingsService.setGlobalSetting(db, 'pipeline_video_concurrency', n);
      } else {
        settingsService.setUserSetting(db, userId, 'pipeline_video_concurrency', n);
      }
    }
    const saved = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_concurrency', 3);
    const saved_video = isAdmin 
      ? settingsService.getGlobalSetting(db, 'pipeline_video_concurrency', 3)
      : settingsService.getSetting(db, userId, 'pipeline_video_concurrency', 3);
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, {
      concurrency: saved,
      video_concurrency: saved_video,
      video_generation_timeout_minutes,
    });
  };
}

/**
 * 获取支付渠道配置接口（系统管理 · 仅 super_admin）
 *
 * 返回微信/支付宝商户凭据的「脱敏」视图：密钥类字段只返回是否已配置（configured）与掩码，
 * 绝不回传明文密钥，避免二次泄露。前端据此渲染「已开通 / 未开通」与占位输入框。
 * S17-T03：密钥以 AES-256-GCM 密文落库，脱敏视图识别 ENC 前缀显示「已加密存储」。
 */
function getPaymentSettings(db) {
  return (req, res) => {
    const wechat = settingsService.getGlobalSetting(db, 'pay_wechat', null) || {};
    const alipay = settingsService.getGlobalSetting(db, 'pay_alipay', null) || {};
    const mask = (v) => {
      if (!v) return '';
      if (String(v).startsWith(cryptoUtil.PREFIX)) return 'encrypted(已加密存储)';
      return `${String(v).slice(0, 2)}****${String(v).slice(-2)}`;
    };
    response.success(res, {
      wechat: {
        configured: !!(wechat.mchid || wechat.merchant_id) && !!wechat.api_v3_key
          && Array.isArray(wechat.platform_certs) && wechat.platform_certs.length > 0,
        mchid: wechat.mchid || wechat.merchant_id || '',
        app_id: wechat.app_id || '',
        notify_url: wechat.notify_url || '',
        api_v3_key_mask: mask(wechat.api_v3_key),
        platform_certs_count: Array.isArray(wechat.platform_certs) ? wechat.platform_certs.length : 0,
      },
      alipay: {
        configured: !!alipay.merchant_id && !!alipay.api_key,
        merchant_id: alipay.merchant_id || '',
        app_id: alipay.app_id || '',
        notify_url: alipay.notify_url || '',
        api_key_mask: mask(alipay.api_key),
        sandbox: !!alipay.sandbox, // S17-T06：沙箱/正式环境开关
      },
    });
  };
}

/**
 * 更新支付渠道配置接口（系统管理 · 仅 super_admin）
 *
 * 采用「增量更新」：仅覆盖本次传入的字段，未传字段保留原值（便于只改回调地址而不重填密钥）。
 * 微信 v3 必填校验：mchid + api_v3_key(32字节) + platform_certs（数组）。
 */
function updatePaymentSettings(db, log) {
  return (req, res) => {
    const secret = (loadConfig().app || {}).secret || '';
    const b = req.body || {};
    // —— 微信支付 v3 ——
    if (b.wechat && typeof b.wechat === 'object') {
      const cur = settingsService.getGlobalSetting(db, 'pay_wechat', null) || {};
      const next = { ...cur };
      const w = b.wechat;
      if (w.mchid !== undefined) { next.mchid = String(w.mchid || ''); next.merchant_id = next.mchid; }
      if (w.app_id !== undefined) next.app_id = String(w.app_id || '');
      if (w.notify_url !== undefined) next.notify_url = String(w.notify_url || '');
      if (w.api_v3_key !== undefined && w.api_v3_key !== '') {
        if (String(w.api_v3_key).length !== 32) {
          return response.badRequest(res, '微信 APIv3 密钥必须为 32 字节');
        }
        // S17-T03：AES-256-GCM 加密落库，读取处解密
        next.api_v3_key = cryptoUtil.encryptText(String(w.api_v3_key), secret);
        next.api_key = next.api_v3_key; // 兼容既有「已开通」判定字段
      }
      if (w.platform_certs !== undefined) {
        if (!Array.isArray(w.platform_certs)) return response.badRequest(res, 'platform_certs 需为数组');
        // 每项须含 serial_no 与 public_key_pem
        for (const c of w.platform_certs) {
          if (!c || !(c.serial_no || c.serialNo) || !(c.public_key_pem || c.pem)) {
            return response.badRequest(res, '平台证书每项需包含 serial_no 与 public_key_pem');
          }
        }
        next.platform_certs = w.platform_certs.map((c) => ({
          serial_no: c.serial_no || c.serialNo,
          public_key_pem: cryptoUtil.encryptText(c.public_key_pem || c.pem, secret),
        }));
      }
      settingsService.setGlobalSetting(db, 'pay_wechat', next);
      if (log) log.info('[S13-T04] 微信支付凭据已更新', { mchid: next.mchid, certs: (next.platform_certs || []).length });
    }
    // —— 支付宝 ——
    if (b.alipay && typeof b.alipay === 'object') {
      const cur = settingsService.getGlobalSetting(db, 'pay_alipay', null) || {};
      const next = { ...cur };
      const a = b.alipay;
      if (a.merchant_id !== undefined) next.merchant_id = String(a.merchant_id || '');
      if (a.app_id !== undefined) next.app_id = String(a.app_id || '');
      if (a.notify_url !== undefined) next.notify_url = String(a.notify_url || '');
      if (a.api_key !== undefined && a.api_key !== '') next.api_key = cryptoUtil.encryptText(String(a.api_key), secret);
      if (a.alipay_public_key !== undefined) next.alipay_public_key = cryptoUtil.encryptText(String(a.alipay_public_key || ''), secret);
      if (a.sandbox !== undefined) next.sandbox = !!a.sandbox; // S17-T06：沙箱/正式环境开关
      settingsService.setGlobalSetting(db, 'pay_alipay', next);
      if (log) log.info('[S13-T04] 支付宝凭据已更新', { merchant_id: next.merchant_id, sandbox: next.sandbox });
    }
    return getPaymentSettings(db)(req, res);
  };
}

module.exports = function settingsRoutes(db, cfg, log) {
  return {
    getLanguage: getLanguage(cfg),
    updateLanguage: updateLanguage(cfg, log),
    getGenerationSettings: getGenerationSettings(db),
    updateGenerationSettings: updateGenerationSettings(db),
    getPaymentSettings: getPaymentSettings(db),
    updatePaymentSettings: updatePaymentSettings(db, log),
  };
};