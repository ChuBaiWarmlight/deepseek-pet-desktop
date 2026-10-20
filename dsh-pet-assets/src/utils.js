// 视图间共享的展示格式化/解析工具函数。

export function parseTags(it) {
  try {
    return JSON.parse(it.tags || '[]')
  } catch {
    return []
  }
}

export function fmtTime(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function fmtDetail(d) {
  if (d == null) return ''
  if (typeof d === 'string') return d
  try {
    return JSON.stringify(d)
  } catch {
    return ''
  }
}

export function statusText(s) {
  return { pending: '待执行', delivered: '已下发', done: '已完成' }[s] || s
}

export function statusType(s) {
  return { pending: 'warning', delivered: 'primary', done: 'success' }[s] || 'info'
}

export function shortPayload(row) {
  const p = row.payload || {}
  if (row.type === 'play') return p.anim || ''
  if (row.type === 'say' || row.type === 'notify' || row.type === 'tts') return p.text || ''
  if (row.type === 'set_state' || row.type === 'config') return (p.key || '') + '=' + (p.value ?? '')
  if (row.type === 'skin') return p.id || p.skin || ''
  return ''
}

// 后端英文错误枚举 → 中文提示；未映射的原样返回（空则返回 ''）。
const ERR_TEXT = {
  unauthorized: '未登录或会话已过期',
  'invalid credentials': '用户名或密码错误',
  'invalid json': '请求格式错误',
  'username and password required': '请输入用户名和密码',
  'new password too short (>= 8)': '新密码至少 8 位',
  'old password incorrect': '原密码错误',
  'missing X-File-Name header': '缺少文件名',
  'invalid file name': '文件名不合法（仅支持 .webm）',
  'invalid file name (only .webm)': '文件名不合法（仅支持 .webm）',
  'file too large (max 6MB)': '文件过大（最大 6MB）',
  'invalid category': '分类不合法',
  'file exists': '同名文件已存在',
  'name exists': '同名动作已存在',
  'not found': '资源不存在',
  'not in trash': '不在回收站中',
  'tags must be array': '标签格式错误',
  'invalid name': '名称不合法',
  'unknown command type': '未知的命令类型',
  'device unauthorized': '设备未配对或令牌无效',
  'invalid cron': 'cron 表达式不合法（需 5 段：分 时 日 月 周）',
  'bad request': '请求有误',
}

export function errText(e) {
  if (!e) return ''
  if (typeof e !== 'string') return String(e)
  if (ERR_TEXT[e]) return ERR_TEXT[e]
  if (e.startsWith('rename failed')) return '重命名失败'
  return e
}
