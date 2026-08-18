#!/usr/bin/env bash
# ============================================================
# restore.sh — 从备份目录恢复 LocalMiniDrama（数据库 + 存储）
# 用法: bash deploy/opsScripts/restore.sh <备份目录> [--yes]
# 注意: 会覆盖现有数据库与存储文件！非交互（NON_INTERACTIVE=1）自动跳过确认。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

BACKUP_DIR="${1:-}"
[ -n "${BACKUP_DIR}" ] || { echo "[restore][错误] 请指定备份目录，如: bash deploy/opsScripts/restore.sh backups/20260101_120000"; exit 1; }
[ -d "${BACKUP_DIR}" ] || { echo "[restore][错误] 备份目录不存在: ${BACKUP_DIR}"; exit 1; }

CONFIRM=""
[ "${2:-}" = "--yes" ] && CONFIRM="1"
[ "${NON_INTERACTIVE:-0}" = "1" ] && CONFIRM="1"
if [ -z "${CONFIRM}" ]; then
  read -r -p "[restore] 恢复将覆盖现有数据库与存储，确定继续? (y/N) " answer
  [ "${answer}" = "y" ] || [ "${answer}" = "Y" ] || { echo "[restore] 已取消"; exit 1; }
fi

echo "[restore] 备份目录: ${BACKUP_DIR}"

# ---- 提取数据库连接（优先使用备份内的 config.yaml，其次当前配置） ----
CONFIG_PATH="${BACKUP_DIR}/config.yaml"
[ -f "${CONFIG_PATH}" ] || CONFIG_PATH="${PROJECT_ROOT}/backend-node/configs/config.yaml"
read -r DB_HOST DB_PORT DB_USER DB_PASS DB_NAME <<<"$(node -e "
const fs = require('fs');
const txt = fs.readFileSync(process.argv[1], 'utf8');
const g = (k) => {
  const m = txt.match(new RegExp('^' + k + ':\\\\s*(.*)$', 'm'));
  return m ? m[1].trim().replace(/^[\"']|[\"']$/g, '') : '';
};
console.log([g('  host'), g('  port'), g('  user'), g('  password'), g('  database')].join(' '));
" "${CONFIG_PATH}")"
DB_HOST="${DB_HOST:-localhost}"; DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"; DB_PASS="${DB_PASS:-}"; DB_NAME="${DB_NAME:-localminidrama}"
[ -n "${DB_PASS}" ] && PASS_ARG="-p${DB_PASS}" || PASS_ARG=""

# ---- 1) 恢复数据库 ----
if [ -f "${BACKUP_DIR}/localminidrama.sql.gz" ]; then
  echo "[restore] 恢复数据库 ${DB_NAME} ..."
  command -v mysql >/dev/null 2>&1 || { echo "[restore][错误] 未找到 mysql 客户端"; exit 1; }
  gunzip -c "${BACKUP_DIR}/localminidrama.sql.gz" \
    | mysql -h"${DB_HOST}" -P"${DB_PORT}" -u"${DB_USER}" ${PASS_ARG} "${DB_NAME}" 2>/dev/null
  echo "[restore] 数据库恢复完成"
else
  echo "[restore][warn] 备份中无数据库文件，跳过（仅恢复存储）"
fi

# ---- 2) 恢复存储 ----
if [ -f "${BACKUP_DIR}/storage.tar.gz" ]; then
  STORAGE_DIR="${PROJECT_ROOT}/backend-node/data/storage"
  echo "[restore] 恢复存储到 ${STORAGE_DIR} ..."
  mkdir -p "${STORAGE_DIR}"
  tar -xzf "${BACKUP_DIR}/storage.tar.gz" -C "${STORAGE_DIR}" --strip-components=1 2>/dev/null \
    || tar -xzf "${BACKUP_DIR}/storage.tar.gz" -C "$(dirname "${STORAGE_DIR}")"
  echo "[restore] 存储恢复完成"
else
  echo "[restore][warn] 备份中无存储文件，跳过"
fi

echo "[restore] ✔ 恢复完成。请执行: cd backend-node && npm run migrate && pm2 reload localminidrama-api"
