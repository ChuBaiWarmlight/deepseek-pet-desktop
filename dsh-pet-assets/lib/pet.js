// 桌宠遥控命令：下发（管理员）、轮询（桌宠）、回执、历史 + 设备配对鉴权（M-05）。
import { randomBytes, createHash } from 'node:crypto'
import { getDb } from './db.js'
import { nowMs } from './util.js'
import { audit } from './audit.js'

export const COMMAND_TYPES = new Set([
  'play', 'say', 'sleep', 'wake', 'celebrate', 'stretch', 'focus', 'set_state',
  'config', 'skin', 'reboot', 'notify', 'tts',
])

export function enqueueCommand(type, payload, user, req, deviceId) {
  if (!COMMAND_TYPES.has(type)) return { status: 400, error: 'unknown command type' }
  const db = getDb()
  const target = deviceId ? String(deviceId).trim() : null
  const info = db
    .prepare('INSERT INTO pet_commands (type, payload, status, created_at, device_id) VALUES (?,?,?,?,?)')
    .run(type, JSON.stringify(payload || {}), 'pending', nowMs(), target)
  audit(user ? user.id : null, 'pet_cmd', type, payload, req)
  return { ok: true, id: info.lastInsertRowid, type, deviceId: target }
}

/** 桌宠轮询：返回该设备可见的 pending 命令并标记为 delivered；超时未回执的 delivered 重新变 pending。 */
export function popPending(deviceId) {
  const db = getDb()
  const now = nowMs()
  db.prepare(
    "UPDATE pet_commands SET status = 'pending', delivered_at = NULL WHERE status = 'delivered' AND delivered_at < ?",
  ).run(now - 60_000)
  // 设备定向命令（device_id = ?）+ 广播命令（device_id IS NULL）
  const cmds = db
    .prepare(
      'SELECT id, type, payload, created_at FROM pet_commands WHERE status = ? AND (device_id IS NULL OR device_id = ?) ORDER BY id ASC',
    )
    .all('pending', deviceId)
  if (cmds.length) {
    const ids = cmds.map((c) => c.id)
    const ph = ids.map(() => '?').join(',')
    db.prepare(`UPDATE pet_commands SET status = 'delivered', delivered_at = ? WHERE id IN (${ph})`).run(now, ...ids)
  }
  return cmds.map((c) => ({ id: c.id, type: c.type, payload: safeJson(c.payload), createdAt: c.created_at }))
}

/** 桌宠回执：标记命令已完成；设备只能回执广播命令或发给自己的命令。 */
export function markDone(id, deviceId) {
  const info = getDb()
    .prepare(
      "UPDATE pet_commands SET status = 'done', done_at = ? WHERE id = ? AND status != 'done' AND (device_id IS NULL OR device_id = ?)",
    )
    .run(nowMs(), id, String(deviceId || ''))
  return { ok: info.changes > 0 }
}

/** 命令历史（控制台展示，倒序）。 */
export function listCommands(limit = 50) {
  const rows = getDb()
    .prepare('SELECT id, type, payload, status, device_id, created_at, delivered_at, done_at FROM pet_commands ORDER BY id DESC LIMIT ?')
    .all(limit)
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    payload: safeJson(r.payload),
    status: r.status,
    deviceId: r.device_id,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
    doneAt: r.done_at,
  }))
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// 设备配对鉴权（M-05）
// ---------------------------------------------------------------------------

/** 生成一次性配对 token，只存 sha256 哈希；明文仅在本次返回值中出现一次。 */
export function pairDevice(deviceId) {
  const id = String(deviceId || '').trim()
  if (!id) return { status: 400, error: 'missing deviceId' }
  const token = randomBytes(24).toString('base64url')
  const hash = createHash('sha256').update(token).digest('hex')
  const now = nowMs()
  getDb()
    .prepare(
      `INSERT INTO pet_devices (device_id, name, version, last_seen, first_seen, device_token_hash)
       VALUES (?, '', '', ?, ?, ?)
       ON CONFLICT(device_id) DO UPDATE SET device_token_hash = excluded.device_token_hash`,
    )
    .run(id, now, now, hash)
  return { ok: true, token }
}

/** 取消配对：清除设备 token 哈希，之后该设备的 poll/done 会 401。 */
export function unpairDevice(deviceId) {
  const info = getDb()
    .prepare('UPDATE pet_devices SET device_token_hash = NULL WHERE device_id = ?')
    .run(String(deviceId || '').trim())
  return { ok: info.changes > 0 }
}

/** 校验 `X-Device-Token` 头，命中则返回设备行，否则 null（供 poll/done 鉴权）。 */
export function verifyDeviceToken(req) {
  const token = String((req && req.headers && req.headers['x-device-token']) || '').trim()
  if (!token) return null
  const hash = createHash('sha256').update(token).digest('hex')
  return getDb().prepare('SELECT * FROM pet_devices WHERE device_token_hash = ?').get(hash) || null
}

/** 桌宠心跳上报：按 device_id upsert 在线状态与遥测快照。
 *  未配对设备允许首次发现；设备一旦配对，后续心跳必须携带正确的 X-Device-Token。
 */
export function upsertDevice(body, req) {
  const db = getDb()
  const deviceId = String(body.deviceId || '').trim()
  if (!deviceId) return { ok: false, error: 'missing deviceId' }
  if (deviceId.length > 120) return { status: 400, error: 'deviceId too long' }
  const existing = db.prepare('SELECT device_id, device_token_hash FROM pet_devices WHERE device_id = ?').get(deviceId)
  if (existing && existing.device_token_hash) {
    const device = verifyDeviceToken(req)
    if (!device || device.device_id !== deviceId) {
      return { status: 401, error: 'device unauthorized' }
    }
  }
  if (!existing) {
    const count = db.prepare('SELECT COUNT(*) AS n FROM pet_devices').get().n
    if (count >= 500) return { status: 429, error: 'too many devices' }
  }
  const now = nowMs()
  const name = String(body.name || '').trim().slice(0, 40)
  const version = String(body.version || '').trim().slice(0, 32)
  const affinity = Number.isFinite(body.affinity) ? Math.round(body.affinity) : 50
  const sass = Number.isFinite(body.sass) ? Math.round(body.sass) : 60
  const personality = Number.isFinite(body.personality) ? Math.round(body.personality) : 50
  const mood = String(body.mood || 'normal').slice(0, 16)
  const model = String(body.model || '').slice(0, 64)
  const dshOnline = body.dshOnline ? 1 : 0
  const todayJson = JSON.stringify(body.today || {})
  const scene = String(body.scene || 'auto').slice(0, 16)
  const stage = String(body.stage || '陌生').slice(0, 24)
  const companionSecs = Math.max(0, Math.min(86400 * 365, Math.round(Number(body.companionSecs) || 0)))
  db.prepare(
    `INSERT INTO pet_devices
      (device_id, name, version, last_seen, first_seen, affinity, sass, personality, mood, model, dsh_online, today_json, scene, stage, companion_secs)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(device_id) DO UPDATE SET
      name = excluded.name,
      version = excluded.version,
      last_seen = excluded.last_seen,
      affinity = excluded.affinity,
      sass = excluded.sass,
      personality = excluded.personality,
      mood = excluded.mood,
      model = excluded.model,
      dsh_online = excluded.dsh_online,
      today_json = excluded.today_json,
      scene = excluded.scene,
      stage = excluded.stage,
      companion_secs = excluded.companion_secs`,
  ).run(
    deviceId,
    name,
    version,
    now,
    now,
    affinity,
    sass,
    personality,
    mood,
    model,
    dshOnline,
    todayJson,
    scene,
    stage,
    companionSecs,
  )
  return { ok: true }
}

/** 设备列表（管理平台「宠物」页）：在线判定 = 90s 内有心跳。 */
export function listDevices() {
  const db = getDb()
  const now = nowMs()
  const rows = db.prepare('SELECT * FROM pet_devices ORDER BY last_seen DESC').all()
  return rows.map((r) => ({
    deviceId: r.device_id,
    name: r.name,
    version: r.version,
    online: now - r.last_seen < 90_000,
    lastSeen: r.last_seen,
    firstSeen: r.first_seen,
    affinity: r.affinity,
    sass: r.sass,
    personality: r.personality,
    mood: r.mood,
    model: r.model,
    dshOnline: !!r.dsh_online,
    scene: r.scene,
    stage: r.stage,
    companionSecs: r.companion_secs,
    paired: !!r.device_token_hash,
    today: safeJson(r.today_json),
  }))
}
