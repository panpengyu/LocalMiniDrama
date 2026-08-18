#!/usr/bin/env bash
# ============================================================
# backup.sh — LocalMiniDrama 全量备份（MySQL dump + 存储 + 配置）
# 用法: bash deploy/opsScripts/backup.sh [输出目录]
# 输出: <输出目录>/backups/<时间戳>/  包含 localminidrama.sql.gz / storage.tar.gz / config.yaml
# 非交互: 设置 NON_INTERACTIVE=1 跳过一切提示（由 opsService 触发）
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
BACKUP_ROOT="${1:-${PROJECT_ROOT}/backups}"
STAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_DIR="${BACKUP_ROOT}/${STAMP}"

echo "[backup] 项目根目录: ${PROJECT_ROOT}"
echo "[backup] 备份目标目录: ${BACKUP_DIR}"
mkdir -p "${BACKUP_DIR}"

# ---- 从 config.yaml 提取数据库与存储配置（node 为项目运行时，必然存在） ----
# 注意：必须在对应段内提取，避免误匹配 server.host / redis.password 等同名键
read -r DB_HOST DB_PORT DB_USER DB_PASS DB_NAME STORAGE_PATH <<<"$(node -e "
const fs = require('fs');
const txt = fs.readFileSync(process.argv[1], 'utf8');
const segment = (startKey, endKey) => {
  const s = txt.indexOf(startKey);
  if (s < 0) return '';
  const e = endKey ? txt.indexOf(endKey, s) : txt.length;
  return txt.slice(s, e < 0 ? txt.length : e);
};
const g = (src, k) => {
  const m = src.match(new RegExp('^  ' + k + ':\\\\s*(.*)$', 'm'));
  return m ? m[1].trim().replace(/^[\"']|[\"']$/g, '') : '';
};
const dbText = segment('database:', 'storage:');
const stText = segment('storage:', 'redis:');
console.log([g(dbText, 'host'), g(dbText, 'port'), g(dbText, 'user'), g(dbText, 'password'), g(dbText, 'database'), g(stText, 'local_path')].join(' '));
" "${PROJECT_ROOT}/backend-node/configs/config.yaml")"

DB_HOST="${DB_HOST:-localhost}"; DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"; DB_PASS="${DB_PASS:-}"; DB_NAME="${DB_NAME:-localminidrama}"
[ -n "${DB_PASS}" ] && PASS_ARG="-p${DB_PASS}" || PASS_ARG=""

echo "[backup] 数据库: ${DB_HOST}:${DB_PORT}/${DB_NAME} (用户 ${DB_USER})"

# ---- 1) MySQL 逻辑备份（OPS_SKIP_DB=1 可跳过，便于按需/快速备份） ----
echo "[backup] 备份数据库 ${DB_NAME} ..."
if [ "${OPS_SKIP_DB:-0}" = "1" ]; then
  echo "[backup][skip] 已跳过数据库备份（OPS_SKIP_DB=1）"
elif command -v mysqldump >/dev/null 2>&1; then
  DUMP_ERR="${BACKUP_DIR}/mysqldump.err"
  # if 保护管道：mysqldump 失败仅记录警告，不中断整体备份（set -e 下管道失败会退出）
  if mysqldump --single-transaction --routines --triggers \
      -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" ${PASS_ARG} "${DB_NAME}" 2>"${DUMP_ERR}" \
      | gzip > "${BACKUP_DIR}/localminidrama.sql.gz"; then
    if [ -s "${BACKUP_DIR}/localminidrama.sql.gz" ]; then
      echo "[backup] 数据库备份完成: ${BACKUP_DIR}/localminidrama.sql.gz ($(du -h "${BACKUP_DIR}/localminidrama.sql.gz" | cut -f1))"
    else
      echo "[backup][warn] mysqldump 输出为空，已跳过数据库备份"
    fi
  else
    echo "[backup][warn] mysqldump 失败（请确认 MySQL 可达与账号权限）: $(head -c 200 "${DUMP_ERR}" 2>/dev/null | tr '\n' ' ')"
  fi
  rm -f "${DUMP_ERR}"
else
  echo "[backup][warn] 未找到 mysqldump，跳过数据库备份（请安装 mysql-client）"
fi

# ---- 2) 存储目录（上传的图片/音频/视频） ----
STORAGE_ABS="${STORAGE_PATH}"
case "${STORAGE_ABS}" in
  /*) : ;;
  *) STORAGE_ABS="${PROJECT_ROOT}/backend-node/${STORAGE_PATH}" ;;
esac
if [ "${OPS_SKIP_STORAGE:-0}" = "1" ]; then
  echo "[backup][skip] 已跳过存储备份（OPS_SKIP_STORAGE=1）"
elif [ -z "${STORAGE_PATH}" ]; then
  echo "[backup][warn] config.yaml 未配置 storage.local_path，跳过存储备份"
elif [ -d "${STORAGE_ABS}" ]; then
  echo "[backup] 打包存储目录 ${STORAGE_ABS} ..."
  tar -czf "${BACKUP_DIR}/storage.tar.gz" -C "$(dirname "${STORAGE_ABS}")" "$(basename "${STORAGE_ABS}")"
  echo "[backup] 存储备份完成: ${BACKUP_DIR}/storage.tar.gz ($(du -h "${BACKUP_DIR}/storage.tar.gz" | cut -f1))"
else
  echo "[backup][warn] 存储目录不存在: ${STORAGE_ABS}，跳过"
fi

# ---- 3) 配置文件 ----
cp "${PROJECT_ROOT}/backend-node/configs/config.yaml" "${BACKUP_DIR}/config.yaml" 2>/dev/null || echo "[backup][warn] 未找到 config.yaml"

echo "[backup] ✔ 备份完成: ${BACKUP_DIR}"
echo "[backup] 恢复方式: bash deploy/opsScripts/restore.sh ${BACKUP_DIR} --yes"
