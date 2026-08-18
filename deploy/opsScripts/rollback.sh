#!/usr/bin/env bash
# ============================================================
# rollback.sh — 发布回滚（Git tag + PM2 reload）
# 用法: bash deploy/opsScripts/rollback.sh <git-tag> [pm2-app名]
#   1) 校验 tag 存在
#   2) stash 未提交改动（避免丢失）
#   3) 检出目标 tag 并同步依赖（package-lock 变化时 npm ci）
#   4) 显式迁移（幂等）+ PM2 reload
# 非交互（NON_INTERACTIVE=1）自动跳过确认。
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
PM2_APP="${2:-localminidrama-api}"

TAG="${1:-}"
[ -n "${TAG}" ] || { echo "[rollback][错误] 请指定回滚目标 tag，如: bash deploy/opsScripts/rollback.sh v1.5.0"; exit 1; }

cd "${PROJECT_ROOT}"

# 1) 校验 tag
git rev-parse --verify "${TAG}^{commit}" >/dev/null 2>&1 \
  || { echo "[rollback][错误] Git tag 不存在: ${TAG}"; echo "可用 tag:"; git tag | tail -20; exit 1; }

CURRENT="$(git describe --tags --always 2>/dev/null || echo unknown)"
echo "[rollback] 当前版本: ${CURRENT} → 目标: ${TAG}"

CONFIRM=""
[ "${NON_INTERACTIVE:-0}" = "1" ] && CONFIRM="1"
if [ -z "${CONFIRM}" ]; then
  read -r -p "[rollback] 将检出 ${TAG} 并 reload PM2 应用 ${PM2_APP}，确定继续? (y/N) " answer
  [ "${answer}" = "y" ] || [ "${answer}" = "Y" ] || { echo "[rollback] 已取消"; exit 1; }
fi

# 2) 保护未提交改动
if [ -n "$(git status --porcelain)" ]; then
  echo "[rollback] 暂存未提交改动: git stash push"
  git stash push -m "auto-stash before rollback to ${TAG}" || { echo "[rollback][错误] stash 失败，已中止"; exit 1; }
fi

# 3) 检出目标版本
git checkout "${TAG}"

# 4) 依赖同步 + 迁移 + 重启
if [ -f backend-node/package-lock.json ]; then
  echo "[rollback] 同步后端依赖 ..."
  (cd backend-node && npm ci --omit=dev 2>/dev/null || npm install --omit=dev)
fi

echo "[rollback] 执行幂等迁移 ..."
(cd backend-node && npm run migrate 2>/dev/null || true)

if command -v pm2 >/dev/null 2>&1 && pm2 jlist >/dev/null 2>&1; then
  echo "[rollback] reload PM2 应用: ${PM2_APP}"
  pm2 reload "${PM2_APP}"
else
  echo "[rollback][warn] 未检测到 PM2 进程，请手动重启后端: cd backend-node && npm run dev"
fi

echo "[rollback] ✔ 回滚完成: ${TAG}"
