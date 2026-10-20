// 多设备记忆同步：同步码只用于定位，平台保存客户端 AES-GCM 加密后的密文。
import { createHash } from 'node:crypto'
import { getDb } from './db.js'
import { nowMs } from './util.js'

const MAX_PAYLOAD = 1_500_000

function hashCode(code) {
  const value = String(code || '').trim()
  if (value.length < 16 || value.length > 512) return null
  return createHash('sha256').update(value).digest('hex')
}

export function putSync(body) {
  const key = hashCode(body.code)
  if (!key) return { status: 400, error: 'sync code must be 16-512 chars' }
  const payload = typeof body.payload === 'string' ? body.payload : ''
  if (!payload || payload.length > MAX_PAYLOAD) return { status: 400, error: 'invalid payload' }
  const now = nowMs()
  const updatedAt = Number.isFinite(body.updatedAt) ? Math.max(0, Math.round(body.updatedAt)) : now
  getDb()
    .prepare(
      `INSERT INTO pet_sync (code_hash, payload, updated_at, created_at)
       VALUES (?,?,?,?)
       ON CONFLICT(code_hash) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    )
    .run(key, payload, updatedAt, now)
  return { ok: true, updatedAt }
}

export function getSync(code) {
  const key = hashCode(code)
  if (!key) return { status: 400, error: 'sync code must be 16-512 chars' }
  const row = getDb()
    .prepare('SELECT payload, updated_at FROM pet_sync WHERE code_hash = ?')
    .get(key)
  if (!row) return { status: 404, error: 'no sync data' }
  return { ok: true, payload: row.payload, updatedAt: row.updated_at }
}

