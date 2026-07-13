/**
 * AI 配置路由模块
 * 
 * 提供 AI 配置的完整 CRUD 操作，包括配置列表、查询、创建、更新、删除、
 * 连接测试、厂商锁定模式管理、批量更新 API Key、ModelArk 资产代理、
 * 即梦2素材列表等功能。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {object} AI 配置路由处理函数集合
 */
const aiConfigService = require('../services/aiConfigService');
const response = require('../response');

/**
 * 获取 AI 配置列表接口
 * 
 * 超级管理员可查看所有配置，普通用户仅查看自己的配置。
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function list(db) {
  return (req, res) => {
    const userId = req.user?.id;
    const isAdmin = req.user?.role === 'super_admin';
    const list = aiConfigService.listConfigs(db, req.query.service_type, isAdmin ? undefined : userId);
    response.success(res, list);
  };
}

/**
 * 获取单个 AI 配置详情接口
 * 
 * @param {object} db - 数据库连接实例
 * @returns {function} Express 路由处理函数
 */
function get(db) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const config = aiConfigService.getConfig(db, id);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, config);
  };
}

/**
 * 获取厂商锁定模式状态接口
 * 
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function vendorLock(cfg) {
  return (req, res) => {
    const status = aiConfigService.getVendorLockStatus(cfg);
    response.success(res, status);
  };
}

/**
 * 创建 AI 配置接口
 * 
 * 厂商锁定模式下不允许创建新配置。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function create(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许添加配置');
    }
    const body = req.body || {};
    if (!body.service_type || !body.name || !body.provider || !body.base_url) {
      return response.badRequest(res, '缺少必填字段: service_type, name, provider, base_url');
    }
    if (body.api_key === undefined || body.api_key === null) {
      return response.badRequest(res, '缺少必填字段: api_key');
    }
    try {
      const isAdmin = req.user?.role === 'super_admin';
      const config = aiConfigService.createConfig(db, log, {
        ...body,
        model: body.model ?? [],
        user_id: isAdmin ? null : req.user?.id,
      });
      response.created(res, config);
    } catch (err) {
      log.errorw('Create AI config failed', { error: err.message });
      response.internalError(res, '创建失败');
    }
  };
}

/**
 * 更新 AI 配置接口
 * 
 * 厂商锁定模式下只允许修改 api_key、default_model、is_default 字段。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function update(db, log, cfg) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');

    let body = req.body || {};
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      const allowed = {};
      if (body.api_key !== undefined) allowed.api_key = body.api_key;
      if (body.default_model !== undefined) allowed.default_model = body.default_model;
      if (body.is_default !== undefined) allowed.is_default = body.is_default;
      body = allowed;
    }

    const config = aiConfigService.updateConfig(db, log, id, body);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, config);
  };
}

/**
 * 删除 AI 配置接口（软删除）
 * 
 * 厂商锁定模式下不允许删除配置。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function remove(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许删除配置');
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const ok = aiConfigService.deleteConfig(db, log, id);
    if (!ok) return response.notFound(res, '配置不存在');
    response.success(res, { message: '删除成功' });
  };
}

/**
 * 批量更新 API Key 接口
 * 
 * 仅在厂商锁定模式下可用，用于统一更新所有配置的 API Key。
 * 
 * @param {object} db - 数据库连接实例
 * @param {object} log - 日志模块
 * @param {object} cfg - 配置对象
 * @returns {function} Express 路由处理函数
 */
function bulkUpdateKey(db, log, cfg) {
  return (req, res) => {
    if (!aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '批量换Key仅在厂商锁定模式下可用');
    }
    const { api_key } = req.body || {};
    if (!api_key || !api_key.trim()) {
      return response.badRequest(res, '请提供新的 API Key');
    }
    try {
      const count = aiConfigService.bulkUpdateApiKey(db, log, api_key.trim());
      response.success(res, { updated: count, message: `已更新 ${count} 条配置的 API Key` });
    } catch (err) {
      log.error('Bulk update api_key failed', { error: err.message });
      response.internalError(res, '批量换Key失败');
    }
  };
}

/**
 * 测试 AI 服务连接接口
 * 
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function testConnection(log) {
  return async (req, res) => {
    const body = req.body || {};
    if (!body.base_url || !body.api_key) {
      return response.badRequest(res, '缺少 base_url 或 api_key');
    }
    try {
      await aiConfigService.testConnection({
        base_url: body.base_url,
        api_key: body.api_key,
        model: body.model,
        provider: body.provider,
        endpoint: body.endpoint,
        service_type: body.service_type,
        settings: body.settings,
      });
      response.success(res, { message: '连接测试成功' });
    } catch (err) {
      log.error('AI config test connection failed', { error: err.message });
      response.badRequest(res, '连接测试失败: ' + (err.message || '未知错误'));
    }
  };
}

/**
 * ModelArk / 方舟私有资产库代理接口
 * 
 * 代理调用 CreateAssetGroup、ListAssets 等官方 Action，与官方接口名一致。
 * 
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function modelArkAsset(log) {
  return async (req, res) => {
    const body = req.body || {};
    const action = (body.action || '').toString().trim();
    try {
      const modelArkAssetProxyService = require('../services/modelArkAssetProxyService');
      const data = await modelArkAssetProxyService.callModelArkAsset(
        {
          base_url: body.base_url,
          api_key: body.api_key,
          action,
          body: body.payload,
          path_mode: body.path_mode,
          http_method: body.http_method,
          api_version: body.api_version,
          auth_mode: body.auth_mode,
          access_key_id: body.access_key_id,
          secret_access_key: body.secret_access_key,
          sign_region: body.sign_region,
          sign_service: body.sign_service,
          session_token: body.session_token,
          project_name: body.project_name,
        },
        log
      );
      response.success(res, data);
    } catch (err) {
      log.error('model-ark-asset proxy failed', { error: err.message, action });
      const status = err.status >= 400 && err.status < 600 ? err.status : 400;
      return response.error(res, status, 'MODEL_ARK_ASSET', err.message || '请求失败', err.payload);
    }
  };
}

/**
 * 即梦2角色认证：代理获取素材列表接口
 * 
 * 表单未保存也可用当前填写的网关与 Token 进行测试。
 * 
 * @param {object} log - 日志模块
 * @returns {function} Express 路由处理函数
 */
function listJimeng2MaterialAssets(log) {
  return async (req, res) => {
    const body = req.body || {};
    const base_url = (body.base_url || '').toString().trim().replace(/\/$/, '');
    const { normalizeMaterialHubToken } = require('../services/jimengMaterialHubService');
    let api_key = normalizeMaterialHubToken(body.api_key || '');
    if (!base_url || !api_key) {
      return response.badRequest(res, '请先填写网关 URL 与 Token');
    }
    const jimengMaterialHubService = require('../services/jimengMaterialHubService');
    const ctx = { baseUrl: base_url, token: api_key };
    const r = await jimengMaterialHubService.listAssets(ctx, { limit: body.limit, cursor: body.cursor }, log);
    if (!r.ok) {
      return response.badRequest(res, String(r.error || '列出素材失败').slice(0, 800));
    }
    response.success(res, r.data);
  };
}

module.exports = function aiConfigRoutes(db, log, cfg) {
  return {
    list: list(db),
    get: get(db),
    vendorLock: vendorLock(cfg),
    create: create(db, log, cfg),
    update: update(db, log, cfg),
    delete: remove(db, log, cfg),
    testConnection: testConnection(log),
    listJimeng2MaterialAssets: listJimeng2MaterialAssets(log),
    modelArkAsset: modelArkAsset(log),
    bulkUpdateKey: bulkUpdateKey(db, log, cfg),
  };
};