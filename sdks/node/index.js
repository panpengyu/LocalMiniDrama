'use strict';

/**
 * LocalMiniDrama 开放平台 API —— Node.js SDK（Sprint 15: S15-T04）
 *
 * 特性：
 *   - Node 18+ 内置 fetch，零运行时依赖
 *   - API Key 认证：X-API-Key 或 Bearer
 *   - 统一异常：OpenApiError（携带 HTTP status 与业务 code）
 *   - 接口覆盖：项目管理 / 剧本生成 / 图片生成 / 素材查询
 *
 * 用法：
 *   const { OpenApiClient } = require('@localmini/open-api');
 *   const client = new OpenApiClient({ baseUrl: 'https://your-host/api/v1/open', apiKey: 'lmd_xxx' });
 *   const list = await client.listDramas({ page: 1, page_size: 20 });
 */

const { OpenApiError } = require('./errors');

// 默认基地址：本地开发默认指向本机后端；生产环境可通过环境变量 OPENAPI_BASE_URL 覆盖
const DEFAULT_BASE_URL = process.env.OPENAPI_BASE_URL || 'http://localhost:5679/api/v1/open';

class OpenApiClient {
  /**
   * @param {Object} options
   * @param {string} [options.baseUrl='http://localhost:5679/api/v1/open'] 开放 API 基地址
   * @param {string} options.apiKey 应用 API Key（必填）
   * @param {number} [options.timeoutMs=60000] 请求超时（毫秒）
   * @param {number} [options.maxRetries=0] 网络错误重试次数
   */
  constructor({ baseUrl = DEFAULT_BASE_URL, apiKey, timeoutMs = 60000, maxRetries = 0, fetch: fetchImpl } = {}) {
    if (!apiKey) throw new TypeError('OpenApiClient: apiKey 是必填项');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
    // 允许注入自定义 fetch（便于测试与自定义传输层）
    this.fetch = fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== 'function') {
      throw new TypeError('OpenApiClient: 需要 Node 18+（内置 fetch）或显式传入 fetch 实现');
    }
  }

  /** 底层请求封装：鉴权 + 超时 + 重试 + 错误归一化 */
  async request(method, path, { query, body } = {}) {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let attempt = 0;
    try {
      // 网络异常允许重试
      for (;;) {
        attempt += 1;
        try {
          const res = await this.fetch(url, {
            method,
            headers: {
              Accept: 'application/json',
              ...(body ? { 'Content-Type': 'application/json' } : {}),
              // 认证：优先 X-API-Key
              'X-API-Key': this.apiKey,
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
            signal: controller.signal,
          });
          return await this._handleResponse(res);
        } catch (err) {
          if (attempt <= this.maxRetries && err.name !== 'AbortError') continue;
          throw err;
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async _handleResponse(res) {
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      /* 非 JSON 响应 */
    }

    if (res.ok) {
      // 成功路径：返回包装 { success, data } 中的 data，或原样返回
      if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
        return data.data;
      }
      return data;
    }

    // 错误路径：网关返回 { code, message }；业务 helper 返回 { error: { code, message } }
    const errorBody = data && data.error ? data.error : data;
    const code = (errorBody && errorBody.code) || `HTTP_${res.status}`;
    const message = (errorBody && errorBody.message) || res.statusText || '请求失败';
    throw new OpenApiError(res.status, code, message);
  }

  /* ============ 项目管理 ============ */

  /**
   * 项目列表
   * @param {Object} [params] { page, page_size, status, genre, keyword }
   */
  listDramas(params = {}) {
    return this.request('GET', '/dramas', { query: params });
  }

  /**
   * 项目详情
   * @param {number} id 项目 ID
   */
  getDrama(id) {
    return this.request('GET', `/dramas/${id}`);
  }

  /**
   * 创建项目
   * @param {Object} payload { title, description?, genre?, style?, metadata? }
   */
  createDrama(payload) {
    return this.request('POST', '/dramas', { body: payload });
  }

  /* ============ 剧本生成 ============ */

  /**
   * 生成剧本大纲
   * @param {Object} payload { idea, drama_id?, title?, genre?, style?, structure?, episode_count?, target_audience?, model? }
   */
  generateOutline(payload) {
    return this.request('POST', '/screenplay/outlines', { body: payload });
  }

  /**
   * 生成角色档案
   * @param {Object} payload { outline_id, drama_id?, count? }
   */
  generateCharacters(payload) {
    return this.request('POST', '/screenplay/characters', { body: payload });
  }

  /* ============ 图片生成 ============ */

  /**
   * 提交图片生成（异步）
   * @param {Object} payload { drama_id, scene_id?, storyboard_id?, prompt?, negative_prompt?, frame_type?, reference_images?, provider?, model?, size? }
   * @returns {Promise<{image_id, task_id, status}>}
   */
  createImage(payload) {
    return this.request('POST', '/images', { body: payload });
  }

  /**
   * 查询图片生成结果
   * @param {string} taskId 任务 ID
   */
  getImageTask(taskId) {
    return this.request('GET', `/images/${encodeURIComponent(taskId)}`);
  }

  /* ============ 素材查询 ============ */

  /**
   * 素材列表
   * @param {Object} [params] { drama_id?, type?, page?, page_size? }
   */
  listAssets(params = {}) {
    return this.request('GET', '/assets', { query: params });
  }
}

module.exports = { OpenApiClient, OpenApiError };
