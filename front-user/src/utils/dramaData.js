/**
 * dramaData.js — 项目数据(drama)加载与统计的通用工具函数
 *
 * 背景：
 *   @localmini/shared 的 request 拦截器已经对后端响应做了一次解包
 *   (res.data !== undefined ? res.data : res)，调用方拿到的就是 drama 对象本身。
 *   之前 WorkbenchCanvas.vue 误写了 `res?.data || null`，导致对已解包的对象二次访问 .data，
 *   把正常项目的 drama 丢成 null。提取此工具函数统一管理，避免同类 bug。
 */

/**
 * 将 dramaAPI.get() 的返回值安全赋值为 drama 对象（或 null）。
 *
 * 拦截器已经解包，调用方拿到的 res 就是：
 *   - 正常项目 → drama 对象本身
 *   - 空项目   → null
 *   - 兜底     → 整个 response body（无 .data 字段时）
 *
 * 因此这里只需 `res || null`，绝不能再次 `.data`。
 *
 * @param {*} res - dramaAPI.get() 的返回值（已被拦截器解包）
 * @returns {object|null} drama 对象，或 null
 */
export function unwrapDramaResponse(res) {
  return res || null
}

/**
 * 估算 drama 对象对应的画布节点总数。
 *
 * 节点 = 角色 + 场景 + 道具 + 所有分集的分镜
 * 对 null/undefined/缺字段均安全，返回 0 而非 NaN。
 *
 * @param {object|null} drama - drama 对象（可为 null）
 * @returns {number} 估算节点数
 */
export function estimateNodeCount(drama) {
  const chars = drama?.characters?.length || 0
  const scenes = drama?.scenes?.length || 0
  const props = drama?.props?.length || 0
  const storyboards = (drama?.episodes || []).reduce(
    (sum, ep) => sum + (ep?.storyboards?.length || 0),
    0,
  )
  return chars + scenes + props + storyboards
}
