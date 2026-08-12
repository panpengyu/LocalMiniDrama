/**
 * Sprint 11 - S11-T01 / S11-T03 / S11-T04 / S11-T05
 * 协作实时通信客户端（Socket.io 封装）
 *
 * 提供 useCollaboration 组合式函数，供工作台画布集成：
 *   - connect(dramaId)  建立连接、JWT 握手、加入项目房间
 *   - lockNode / unlockNode / renewLock   节点锁(S11-T04)
 *   - sendCanvasOp      广播画布操作(S11-T03)，支持冲突回执(S11-T04)
 *   - sendComment       发送评论(S11-T05)
 *   - 事件回调：onCanvasOp / onNodeLocked / onNodeUnlocked / onMemberJoined /
 *               onMemberLeft / onComment / onLocksReleased
 *
 * 复用应用的 user_token（与 utils/request 一致）。断线自动重连，重连后自动重新入房。
 */

import { ref, reactive, readonly } from 'vue'
import { io } from 'socket.io-client'

const TOKEN_KEY = 'user_token'
// 锁心跳续约周期（后端锁 TTL 90s，客户端 30s 续约一次）
const LOCK_RENEW_INTERVAL = 30000

export function useCollaboration() {
  const socket = ref(null)
  const connected = ref(false)
  const currentDramaId = ref(null)
  const myRoleTag = ref(null)
  const online = ref([])
  const locks = reactive({}) // { [nodeKey]: { lockedBy, lockedByName } }

  // 事件回调注册表（组件按需覆盖）
  const handlers = {
    onCanvasOp: null,
    onNodeLocked: null,
    onNodeUnlocked: null,
    onMemberJoined: null,
    onMemberLeft: null,
    onComment: null,
    onLocksReleased: null,
    onConnectError: null,
    // 断线重连成功后触发（首次连接不触发），供上层重刷通知等非锁状态
    onReconnect: null
  }

  let renewTimer = null
  const myLockedKeys = new Set()
  // 标记是否已完成过首次连接，用于区分「首连」与「重连」
  let hasConnectedOnce = false

  function on(event, fn) {
    if (event in handlers) handlers[event] = fn
  }

  function _startRenewLoop() {
    _stopRenewLoop()
    renewTimer = setInterval(() => {
      if (!socket.value || !connected.value || !currentDramaId.value) return
      myLockedKeys.forEach((nodeKey) => {
        socket.value.emit('collab:lock_renew', { dramaId: currentDramaId.value, nodeKey })
      })
    }, LOCK_RENEW_INTERVAL)
  }

  function _stopRenewLoop() {
    if (renewTimer) { clearInterval(renewTimer); renewTimer = null }
  }

  /** 建立连接并加入项目房间 */
  function connect(dramaId) {
    if (socket.value) disconnect()
    currentDramaId.value = Number(dramaId)
    // 全新连接会话：重置「首连」标记，避免把首个 connect 误判为重连
    hasConnectedOnce = false
    const token = localStorage.getItem(TOKEN_KEY) || ''

    const s = io('/', {
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000
    })
    socket.value = s

    s.on('connect', () => {
      connected.value = true
      _joinRoom()
      // 首次连接由上层 onOpen 初始化；断线重连时通知上层重刷锁/通知等非锁快照
      if (hasConnectedOnce) {
        if (handlers.onReconnect) handlers.onReconnect()
      }
      hasConnectedOnce = true
    })

    s.on('connect_error', (err) => {
      connected.value = false
      if (handlers.onConnectError) handlers.onConnectError(err)
    })

    s.on('disconnect', () => {
      connected.value = false
    })

    // ---- S11-T03: 画布操作同步 ----
    s.on('collab:canvas_op', (data) => {
      if (handlers.onCanvasOp) handlers.onCanvasOp(data)
    })

    // ---- S11-T04: 锁事件 ----
    s.on('collab:node_locked', (data) => {
      locks[data.nodeKey] = { lockedBy: data.lockedBy, lockedByName: data.lockedByName }
      if (handlers.onNodeLocked) handlers.onNodeLocked(data)
    })
    s.on('collab:node_unlocked', (data) => {
      delete locks[data.nodeKey]
      if (handlers.onNodeUnlocked) handlers.onNodeUnlocked(data)
    })
    s.on('collab:locks_released', (data) => {
      if (handlers.onLocksReleased) handlers.onLocksReleased(data)
    })

    // ---- S11-T05: 成员/评论 ----
    s.on('collab:member_joined', (data) => {
      if (handlers.onMemberJoined) handlers.onMemberJoined(data)
    })
    s.on('collab:member_left', (data) => {
      if (handlers.onMemberLeft) handlers.onMemberLeft(data)
    })
    s.on('collab:comment', (data) => {
      if (handlers.onComment) handlers.onComment(data)
    })

    return s
  }

  function _joinRoom() {
    if (!socket.value || !currentDramaId.value) return
    socket.value.emit('collab:join', { dramaId: currentDramaId.value }, (resp) => {
      if (resp && resp.ok) {
        myRoleTag.value = resp.roleTag
        online.value = resp.online || []
        // 初始化锁快照
        Object.keys(locks).forEach((k) => delete locks[k])
        ;(resp.locks || []).forEach((l) => {
          locks[l.node_key] = { lockedBy: l.locked_by, lockedByName: l.locked_by_name }
        })
        _startRenewLoop()
      }
    })
  }

  /** S11-T04: 请求锁定节点，返回 Promise<{ok, conflict?}> */
  function lockNode(nodeKey) {
    return new Promise((resolve) => {
      if (!socket.value || !connected.value) return resolve({ ok: false, error: '未连接' })
      socket.value.emit('collab:lock', { dramaId: currentDramaId.value, nodeKey }, (resp) => {
        if (resp && resp.ok) myLockedKeys.add(nodeKey)
        resolve(resp || { ok: false })
      })
    })
  }

  /** S11-T04: 解锁节点 */
  function unlockNode(nodeKey, force = false) {
    return new Promise((resolve) => {
      if (!socket.value || !connected.value) return resolve({ ok: false })
      socket.value.emit('collab:unlock', { dramaId: currentDramaId.value, nodeKey, force }, (resp) => {
        myLockedKeys.delete(nodeKey)
        resolve(resp || { ok: false })
      })
    })
  }

  /**
   * S11-T03: 广播画布操作。
   * @param {object} op { action, nodeKey?, data?, baseVersion? }
   * @returns Promise<{ok, version?, conflict?, serverVersion?}>
   */
  function sendCanvasOp(op) {
    return new Promise((resolve) => {
      if (!socket.value || !connected.value) return resolve({ ok: false, error: '未连接' })
      socket.value.emit('collab:canvas_op', { dramaId: currentDramaId.value, op }, (resp) => {
        resolve(resp || { ok: false })
      })
    })
  }

  /** S11-T05: 发送评论 */
  function sendComment(text, nodeKey = null) {
    return new Promise((resolve) => {
      if (!socket.value || !connected.value) return resolve({ ok: false })
      socket.value.emit('collab:comment', { dramaId: currentDramaId.value, text, nodeKey }, (resp) => {
        resolve(resp || { ok: false })
      })
    })
  }

  function disconnect() {
    _stopRenewLoop()
    myLockedKeys.clear()
    if (socket.value) {
      try {
        if (currentDramaId.value) {
          socket.value.emit('collab:leave', { dramaId: currentDramaId.value })
        }
        socket.value.disconnect()
      } catch (_) { /* ignore */ }
      socket.value = null
    }
    connected.value = false
    Object.keys(locks).forEach((k) => delete locks[k])
  }

  return {
    connected: readonly(connected),
    myRoleTag: readonly(myRoleTag),
    online,
    locks,
    connect,
    disconnect,
    on,
    lockNode,
    unlockNode,
    sendCanvasOp,
    sendComment
  }
}

export default useCollaboration
