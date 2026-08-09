/**
 * Sprint 6 — S6-T02 视图书签功能
 *
 * 验收标准：
 *   - 保存当前视口为书签（持久化到后端 canvas_bookmarks 表）
 *   - 书签下拉列表展示，点击跳转回该视口（平滑动画）
 *   - 支持删除书签
 *
 * API（同源 fetch，baseURL 为空）：
 *   GET    /api/v1/dramas/:dramaId/bookmarks
 *   POST   /api/v1/dramas/:dramaId/bookmarks   body: { name, viewportX, viewportY, viewportZoom }
 *   DELETE /api/v1/bookmarks/:id
 *
 * 跳转策略：
 *   书签存储的是 VueFlow 屏幕空间平移量 (viewport_x/y/zoom)。
 *   通过构造"屏幕中心对应的世界坐标点"作为虚拟节点，复用 zoomModes.smoothFitToNode
 *   平滑过渡到 (vx, vy, vz)，无需修改 zoomModes composable。
 *     worldX = (canvasW/2 - vx) / vz
 *     worldY = (canvasH/2 - vy) / vz
 */
import { ref } from 'vue'
import { ElMessage } from 'element-plus'

const TOKEN_KEY = 'user_token'

/**
 * 统一的 fetch 助手：自动携带 Bearer token、解析 { success, data } 包装。
 * 后端未实现该路由时抛出 Error，由调用方降级处理（避免阻塞 UI）。
 */
export async function apiJson(url, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY)
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })
  const text = await res.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch (_) { /* 非 JSON 响应 */ }
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `请求失败 (${res.status})`
    throw new Error(msg)
  }
  if (json && json.success === false) {
    throw new Error(json?.error?.message || '请求失败')
  }
  return json && json.data !== undefined ? json.data : json
}

export function useCanvasBookmarks() {
  const bookmarks = ref([])
  const loading = ref(false)

  /** 从后端加载书签列表（后端未实现时静默置空） */
  async function loadBookmarks(dramaId) {
    if (!dramaId) return
    loading.value = true
    try {
      const data = await apiJson(`/api/v1/dramas/${dramaId}/bookmarks`)
      const list = Array.isArray(data) ? data : (data?.items || data?.list || [])
      bookmarks.value = list
    } catch (e) {
      // 后端可能尚未提供该接口，静默处理避免打扰用户
      bookmarks.value = []
    } finally {
      loading.value = false
    }
  }

  /**
   * 保存当前视口为书签
   * @param {number|string} dramaId
   * @param {{x,y,zoom}} viewport
   * @param {string} name
   */
  async function saveBookmark(dramaId, viewport, name) {
    if (!dramaId || !viewport) return null
    const body = {
      name: name || `视口 ${Math.round((viewport.zoom || 1) * 100)}%`,
      viewportX: viewport.x,
      viewportY: viewport.y,
      viewportZoom: viewport.zoom,
    }
    try {
      const data = await apiJson(`/api/v1/dramas/${dramaId}/bookmarks`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (data) {
        // 后端可能返回 snake_case 字段，统一追加到列表
        bookmarks.value = [...bookmarks.value, data]
      }
      return data
    } catch (e) {
      ElMessage.error('保存书签失败：' + e.message)
      return null
    }
  }

  /**
   * 平滑跳转到书签视口
   * @param {Object} bookmark - 含 viewport_x/y/zoom（兼容 camelCase）
   * @param {Object} zoomModes - useCanvasZoomModes 返回值
   * @param {number} canvasW
   * @param {number} canvasH
   */
  function jumpToBookmark(bookmark, zoomModes, canvasW, canvasH) {
    if (!bookmark || !zoomModes) return
    const vz = bookmark.viewport_zoom != null ? bookmark.viewport_zoom : bookmark.viewportZoom
    const vx = bookmark.viewport_x != null ? bookmark.viewport_x : bookmark.viewportX
    const vy = bookmark.viewport_y != null ? bookmark.viewport_y : bookmark.viewportY
    if (vz == null || vx == null || vy == null) return
    const cw = canvasW || 1000
    const ch = canvasH || 800
    // 屏幕中心对应的世界坐标 → 作为虚拟节点传给 smoothFitToNode
    const worldX = (cw / 2 - vx) / vz
    const worldY = (ch / 2 - vy) / vz
    zoomModes.smoothFitToNode(
      { position: { x: worldX, y: worldY } },
      { zoom: vz, duration: 420, canvasW: cw, canvasH: ch }
    )
  }

  /** 删除书签 */
  async function deleteBookmark(id) {
    if (!id) return
    try {
      await apiJson(`/api/v1/bookmarks/${id}`, { method: 'DELETE' })
      bookmarks.value = bookmarks.value.filter((b) => b.id !== id)
    } catch (e) {
      ElMessage.error('删除书签失败：' + e.message)
    }
  }

  return {
    bookmarks,
    loading,
    loadBookmarks,
    saveBookmark,
    jumpToBookmark,
    deleteBookmark,
  }
}
