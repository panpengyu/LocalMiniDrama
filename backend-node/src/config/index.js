const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPaths = [
  path.join(process.cwd(), 'configs', 'config.yaml'),
  path.join(process.cwd(), 'config.yaml'),
  path.join(__dirname, '..', '..', 'configs', 'config.yaml'),
];

// S16-T02 性能优化：配置缓存（文件 mtime 变更才重新加载），避免每个请求重复读盘/解析 YAML
let configCache = null;
let configCacheMtime = 0;

function loadConfig() {
  // 找到实际存在的配置文件并读取 mtime
  let target = null;
  let mtime = 0;
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      target = p;
      try { mtime = fs.statSync(p).mtimeMs; } catch (_) { mtime = 0; }
      break;
    }
  }
  // 命中缓存且文件未变更 → 直接返回
  if (configCache && target && mtime === configCacheMtime) {
    return configCache;
  }
  let raw = null;
  if (target) raw = fs.readFileSync(target, 'utf8');
  if (!raw) {
    throw new Error('Config file not found: configs/config.yaml');
  }
  const parsed = yaml.load(raw);
  if (!parsed?.app?.name) {
    throw new Error('Invalid config: missing app section');
  }
  configCache = applyEnvOverrides(parsed);
  configCacheMtime = mtime;
  return configCache;
}

/**
 * 敏感配置的环境变量覆盖（生产安全注入，凭证不落盘）。
 * 优先级：环境变量 > config.yaml > 代码内默认值。
 * 生产环境请优先通过环境变量注入敏感值，避免明文写入配置文件：
 *   JWT_SECRET / APP_SECRET / ADMIN_INIT_PASSWORD
 *   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
 * @param {object} cfg - 从 YAML 解析出的配置对象（原地修改并返回）
 * @returns {object} 应用环境变量覆盖后的配置
 */
function applyEnvOverrides(cfg) {
  const overrides = {
    'app.secret': process.env.APP_SECRET,
    'app.jwt_secret': process.env.JWT_SECRET,
    'app.admin_init_password': process.env.ADMIN_INIT_PASSWORD,
    'database.host': process.env.DB_HOST,
    'database.port': process.env.DB_PORT,
    'database.user': process.env.DB_USER,
    'database.password': process.env.DB_PASSWORD,
    'database.database': process.env.DB_NAME,
  };
  for (const [dotPath, value] of Object.entries(overrides)) {
    if (value === undefined || value === null || value === '') continue;
    const keys = dotPath.split('.');
    let node = cfg;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!node[keys[i]] || typeof node[keys[i]] !== 'object') node[keys[i]] = {};
      node = node[keys[i]];
    }
    node[keys[keys.length - 1]] = keys[keys.length - 1] === 'port' ? Number(value) : value;
  }
  return cfg;
}

module.exports = { loadConfig };
