/** 统一媒体 URL：优先 local_path，其次 ref_image，再 image_url */
export function assetImageUrl(item) {
  if (!item) return ''
  const lp = item.local_path && String(item.local_path).trim()
  if (lp) return '/static/' + lp.replace(/^\//, '')
  const rp = item.ref_image && String(item.ref_image).trim()
  if (rp) return rp.startsWith('http') ? rp : '/static/' + rp.replace(/^\//, '')
  return item.image_url || ''
}

export function storyboardImageUrl(sb) {
  if (!sb) return ''
  return assetImageUrl(sb)
}

export function storyboardVideoUrl(sb) {
  if (!sb) return ''
  const lp = sb.video_local_path && String(sb.video_local_path).trim()
  if (lp) return '/static/' + lp.replace(/^\//, '')
  return sb.video_url || ''
}

export function audioUrl(localPath) {
  if (!localPath) return ''
  const p = String(localPath).trim()
  if (!p) return ''
  return '/static/' + p.replace(/^\//, '')
}
