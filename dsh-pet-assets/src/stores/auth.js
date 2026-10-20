// 鉴权状态单例：登录态检查与失效管理，供路由守卫与 401 钩子使用。
import { reactive } from 'vue'
import { api } from '../api'

const state = reactive({ checked: false, user: null })

async function checkAuth() {
  if (state.checked) return state.user
  const { status, data } = await api.me()
  if (status === 200) state.user = data
  else state.user = null
  state.checked = true
  return state.user
}

// 登录成功后调用，使守卫判定即时更新，避免「登录成功却被守卫弹回」。
function setAuthed(user) {
  state.user = user
  state.checked = true
}

// 登出或任意非 /api/auth/* 接口 401 后调用。
function clearAuth() {
  state.user = null
  state.checked = true
}

export function useAuth() {
  return { state, checkAuth, setAuthed, clearAuth }
}
