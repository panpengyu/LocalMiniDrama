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
  configCache = parsed;
  configCacheMtime = mtime;
  return parsed;
}

module.exports = { loadConfig };
