'use strict';

/**
 * Sprint 12 - S12-T03 存储适配器工厂
 *
 * 依据 config.storage.type 返回对应适配器实例（单例）。
 *   local            → LocalAdapter（默认，完整可用）
 *   minio/oss/cos     → MinIOAdapter（S3 协议，惰性加载 SDK）
 *
 * 配置示例（config.yaml）：
 *   storage:
 *     type: local            # local | minio | oss | cos
 *     local_path: ./data/storage
 *     base_url: http://localhost:5679/static
 *     # 选用对象存储时：
 *     endpoint: http://127.0.0.1:9000
 *     region: us-east-1
 *     bucket: localminidrama
 *     access_key: xxx
 *     secret_key: xxx
 *     public_base_url: http://cdn.example.com/localminidrama
 */
const path = require('path');
const LocalAdapter = require('./LocalAdapter');
const MinIOAdapter = require('./MinIOAdapter');

let cachedAdapter = null;
let cachedType = null;

function resolveLocalRoot(cfg) {
  const lp = cfg?.storage?.local_path;
  if (lp) {
    return path.isAbsolute(lp) ? lp : path.join(process.cwd(), lp);
  }
  return path.join(process.cwd(), 'data', 'storage');
}

/**
 * 依据配置构造适配器（不缓存，供测试/迁移显式指定后端）。
 */
function createAdapter(cfg, typeOverride = null) {
  const st = cfg?.storage || {};
  const type = (typeOverride || st.type || 'local').toLowerCase();

  if (type === 'local') {
    return new LocalAdapter({
      root: resolveLocalRoot(cfg),
      baseUrl: st.base_url || '/static',
    });
  }
  if (type === 'minio' || type === 'oss' || type === 'cos') {
    return new MinIOAdapter({
      backend: type,
      endpoint: st.endpoint,
      region: st.region,
      bucket: st.bucket,
      accessKey: st.access_key,
      secretKey: st.secret_key,
      publicBaseUrl: st.public_base_url || st.base_url,
      forcePathStyle: st.force_path_style,
    });
  }
  throw new Error(`未知存储后端类型: ${type}（应为 local/minio/oss/cos）`);
}

/**
 * 获取全局单例适配器（配置变化时自动重建）。
 */
function getAdapter(cfg) {
  const type = (cfg?.storage?.type || 'local').toLowerCase();
  if (cachedAdapter && cachedType === type) return cachedAdapter;
  cachedAdapter = createAdapter(cfg);
  cachedType = type;
  return cachedAdapter;
}

/** 测试用：重置缓存 */
function resetAdapter() {
  cachedAdapter = null;
  cachedType = null;
}

module.exports = {
  createAdapter,
  getAdapter,
  resetAdapter,
  resolveLocalRoot,
  LocalAdapter,
  MinIOAdapter,
};
