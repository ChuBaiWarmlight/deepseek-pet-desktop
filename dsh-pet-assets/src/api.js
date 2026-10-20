// 后端 API 封装（与服务端 REST 契约对齐）。
const BASE = ''

// 401 统一处理钩子：仅对非 /api/auth/* 路径的 401 触发（登录/改密的 401 属业务失败，走各自错误提示）。
let onUnauthorized = null
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn
}

async function request(path, opts = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(opts.headers || {}) },
    ...opts,
  })
  let data = {}
  try {
    data = await res.json()
  } catch {}
  if (res.status === 401 && !path.startsWith('/api/auth/') && typeof onUnauthorized === 'function') {
    onUnauthorized()
  }
  return { status: res.status, data }
}

export const api = {
  health: () => request('/api/health'),
  manifest: () => request('/api/manifest'),
  login: (username, password) =>
    request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  me: () => request('/api/auth/me'),
  changePassword: (oldPassword, newPassword) =>
    request('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oldPassword, newPassword }),
    }),
  resources: () => request('/api/resources'),
  upload: (file, category) =>
    request('/api/resources?category=' + encodeURIComponent(category), {
      method: 'POST',
      headers: { 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'video/webm' },
      body: file,
    }),
  remove: (file) => request('/api/resources/' + encodeURIComponent(file), { method: 'DELETE' }),
  patch: (file, body) =>
    request('/api/resources/' + encodeURIComponent(file), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  rebuild: () => request('/api/rebuild', { method: 'POST' }),
  petCommands: () => request('/api/pet/commands'),
  petCommand: (type, payload, deviceIds) =>
    request('/api/pet/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, payload, deviceIds }),
    }),
  schedules: () => request('/api/schedules'),
  createSchedule: (body) =>
    request('/api/schedules', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateSchedule: (id, body) =>
    request(`/api/schedules/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  deleteSchedule: (id) => request(`/api/schedules/${id}`, { method: 'DELETE' }),
  pets: () => request('/api/pets'),
  pairPet: (deviceId) => request(`/api/pets/${encodeURIComponent(deviceId)}/pair`, { method: 'POST' }),
  unpairPet: (deviceId) => request(`/api/pets/${encodeURIComponent(deviceId)}/unpair`, { method: 'POST' }),
  auditLogs: (params = {}) => {
    const qs = new URLSearchParams()
    if (params.action) qs.set('action', params.action)
    if (params.limit) qs.set('limit', String(params.limit))
    if (params.offset) qs.set('offset', String(params.offset))
    if (params.from) qs.set('from', String(params.from))
    if (params.to) qs.set('to', String(params.to))
    const s = qs.toString()
    return request('/api/audit' + (s ? '?' + s : ''))
  },
  trashList: () => request('/api/trash'),
  restoreTrash: (name) => request(`/api/trash/${encodeURIComponent(name)}/restore`, { method: 'POST' }),
  purgeTrash: (name) => request(`/api/trash/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  healthCheck: () => request('/api/health-check'),
}

export function videoUrl(file) {
  return '/assets/videos/' + encodeURIComponent(file)
}

export function fmtBytes(n) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(2) + ' MB'
}

export const CATEGORIES = [
  { id: 'idle', label: '待机', color: '#7bd3ea' },
  { id: 'turn', label: '张望', color: '#9b8cff' },
  { id: 'move', label: '移动', color: '#8fe3a1' },
  { id: 'click', label: '点击', color: '#ff8fa3' },
  { id: 'drag', label: '拖拽', color: '#ffb26b' },
  { id: 'sleep', label: '睡眠', color: '#7b8cff' },
  { id: 'wake', label: '唤醒', color: '#ffd75e' },
  { id: 'focus', label: '专注', color: '#5ed6c4' },
  { id: 'celebrate', label: '庆祝', color: '#ff9ed2' },
  { id: 'stretch', label: '拉伸', color: '#c89bff' },
  { id: 'act', label: '随机', color: '#ffc857' },
]

export function catColor(id) {
  return CATEGORIES.find((c) => c.id === id)?.color || '#9b8cff'
}

export function catLabel(id) {
  return CATEGORIES.find((c) => c.id === id)?.label || id
}
