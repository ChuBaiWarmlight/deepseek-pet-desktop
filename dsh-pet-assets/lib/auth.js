// 认证：scrypt 密码哈希 + Session token（HttpOnly Cookie）。
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { getDb } from './db.js'
import { nowMs } from './util.js'

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64
const SESSION_TTL_MS = 12 * 60 * 60 * 1000
export const COOKIE_NAME = 'dpa_session'

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPassword(password, stored) {
  const parts = String(stored).split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = parseInt(parts[1], 10)
  const r = parseInt(parts[2], 10)
  const p = parseInt(parts[3], 10)
  const salt = Buffer.from(parts[4], 'hex')
  const expected = Buffer.from(parts[5], 'hex')
  let actual
  try {
    actual = scryptSync(password, salt, expected.length, { N: n, r, p })
  } catch {
    return false
  }
  return timingSafeEqual(actual, expected)
}

export function parseCookies(req) {
  const header = req.headers.cookie || ''
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    const v = part.slice(i + 1).trim()
    if (k) out[k] = v
  }
  return out
}

export function createSession(userId, req) {
  const token = randomBytes(32).toString('hex')
  const id = createHash('sha256').update(token).digest('hex')
  const now = nowMs()
  getDb()
    .prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?)',
    )
    .run(
      id,
      userId,
      now,
      now + SESSION_TTL_MS,
      (req.socket && req.socket.remoteAddress) || '',
      String(req.headers['user-agent'] || '').slice(0, 200),
    )
  return token
}

/** 根据请求 Cookie 解析当前登录用户；无效返回 null。 */
export function getSessionUser(req) {
  const cookies = parseCookies(req)
  const token = cookies[COOKIE_NAME]
  if (!token) return null
  const id = createHash('sha256').update(token).digest('hex')
  const s = getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(id)
  if (!s || s.revoked_at || s.expires_at < nowMs()) return null
  const user = getDb().prepare('SELECT * FROM users WHERE id = ?').get(s.user_id)
  if (!user || user.disabled) return null
  return user
}

export function revokeUserSessions(userId) {
  getDb()
    .prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
    .run(nowMs(), userId)
}

export function setSessionCookie(res, token) {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000)
  res.setHeader(
    'set-cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}`,
  )
}

export function clearSessionCookie(res) {
  res.setHeader('set-cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
}

/** 首启创建 admin 账号并返回初始密码；已存在返回 null。 */
export function ensureAdminUser() {
  const db = getDb()
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get('admin')
  if (existing) return null
  const initialPassword = randomBytes(12).toString('base64url')
  db.prepare(
    'INSERT INTO users (username, password_hash, role, disabled, must_change_password, created_at) VALUES (?,?,?,?,?,?)',
  ).run('admin', hashPassword(initialPassword), 'admin', 0, 1, nowMs())
  return initialPassword
}
