// 定时任务：5 段 cron（分 时 日 月 周）触发遥控命令（M-02）。
import { getDb } from './db.js'
import { nowMs } from './util.js'
import { enqueueCommand, COMMAND_TYPES } from './pet.js'

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return {}
  }
}

/** 解析 5 段 cron；非 5 段返回 null。 */
export function parseCron(cron) {
  const parts = String(cron || '').trim().split(/\s+/)
  return parts.length === 5 ? parts : null
}

function singleMatches(expr, value, min, max) {
  if (expr === '*' || expr === '') return true
  let range = expr
  let step = 1
  const slash = expr.indexOf('/')
  if (slash >= 0) {
    range = expr.slice(0, slash)
    step = parseInt(expr.slice(slash + 1), 10) || 1
  }
  let lo
  let hi
  if (range === '' || range === '*') {
    // 纯步进（如 `*/5`）：从该字段下限开始每隔 step 命中一次
    lo = min
    hi = max
  } else {
    const dash = range.indexOf('-')
    if (dash >= 0) {
      lo = parseInt(range.slice(0, dash), 10)
      hi = parseInt(range.slice(dash + 1), 10)
    } else {
      lo = parseInt(range, 10)
      // 单值带步进（如 `5/15`）：从 lo 到字段上限按 step 命中
      hi = step > 1 ? max : lo
    }
  }
  if (Number.isNaN(lo) || Number.isNaN(hi)) return false
  if (value < lo || value > hi) return false
  return (value - lo) % step === 0
}

function fieldMatches(field, value, min, max) {
  return String(field)
    .split(',')
    .some((or) => singleMatches(or.trim(), value, min, max))
}

/** 判断某时刻是否命中 cron（5 段，全部 AND）。 */
export function cronMatches(cron, date) {
  const parts = parseCron(cron)
  if (!parts) return false
  const [minute, hour, dom, month, dow] = parts
  return (
    fieldMatches(minute, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(dom, date.getDate(), 1, 31) &&
    fieldMatches(month, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dow, date.getDay(), 0, 6)
  )
}

/** 每一分钟扫描一次：命中且本分钟未触发的 enabled 任务 → 生成命令并记录 last_run。 */
export function tickSchedules() {
  const db = getDb()
  const now = new Date()
  const minuteKey = Math.floor(nowMs() / 60_000)
  const rows = db.prepare('SELECT * FROM pet_schedules WHERE enabled = 1').all()
  for (const s of rows) {
    if (s.last_run === minuteKey) continue
    if (!cronMatches(s.cron, now)) continue
    const result = enqueueCommand(s.type, safeJson(s.payload), null, null, s.device_id || null)
    if (result.status) {
      console.error('[schedule] 任务生成命令失败:', s.id, result.error)
      continue
    }
    db.prepare('UPDATE pet_schedules SET last_run = ? WHERE id = ?').run(minuteKey, s.id)
  }
}

export function listSchedules() {
  const rows = getDb().prepare('SELECT * FROM pet_schedules ORDER BY id DESC').all()
  return rows.map((r) => ({
    id: r.id,
    cron: r.cron,
    type: r.type,
    payload: safeJson(r.payload),
    deviceId: r.device_id,
    enabled: !!r.enabled,
    lastRun: r.last_run,
    createdAt: r.created_at,
  }))
}

export function createSchedule({ cron, type, payload, deviceId, enabled }) {
  if (!parseCron(cron)) return { status: 400, error: 'invalid cron' }
  if (!COMMAND_TYPES.has(type)) return { status: 400, error: 'unknown command type' }
  const db = getDb()
  const info = db
    .prepare(
      'INSERT INTO pet_schedules (cron, type, payload, device_id, enabled, created_at) VALUES (?,?,?,?,?,?)',
    )
    .run(
      String(cron).trim(),
      type,
      JSON.stringify(payload || {}),
      deviceId ? String(deviceId).trim() : null,
      enabled === false ? 0 : 1,
      nowMs(),
    )
  return { ok: true, id: info.lastInsertRowid }
}

export function updateSchedule(id, patch) {
  const db = getDb()
  const row = db.prepare('SELECT * FROM pet_schedules WHERE id = ?').get(id)
  if (!row) return { status: 404, error: 'not found' }
  const cron = patch.cron !== undefined ? String(patch.cron).trim() : row.cron
  const type = patch.type !== undefined ? patch.type : row.type
  if (!parseCron(cron)) return { status: 400, error: 'invalid cron' }
  if (!COMMAND_TYPES.has(type)) return { status: 400, error: 'unknown command type' }
  const payload = patch.payload !== undefined ? JSON.stringify(patch.payload || {}) : row.payload
  const deviceId = patch.deviceId !== undefined ? (patch.deviceId ? String(patch.deviceId).trim() : null) : row.device_id
  const enabled = patch.enabled !== undefined ? (patch.enabled ? 1 : 0) : row.enabled
  db.prepare(
    'UPDATE pet_schedules SET cron = ?, type = ?, payload = ?, device_id = ?, enabled = ? WHERE id = ?',
  ).run(cron, type, payload, deviceId, enabled, id)
  return { ok: true }
}

export function deleteSchedule(id) {
  const info = getDb().prepare('DELETE FROM pet_schedules WHERE id = ?').run(id)
  return { ok: info.changes > 0 }
}
