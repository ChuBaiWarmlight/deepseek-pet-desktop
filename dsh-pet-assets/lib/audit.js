// 审计日志：记录登录与所有写操作。
import { getDb } from './db.js'
import { nowMs } from './util.js'

export function audit(userId, action, target, detail, req) {
  try {
    getDb()
      .prepare(
        'INSERT INTO audit_logs (user_id, action, target, detail, ip, created_at) VALUES (?,?,?,?,?,?)',
      )
      .run(
        userId ?? null,
        action,
        target ?? null,
        detail != null ? JSON.stringify(detail) : null,
        (req && req.socket && req.socket.remoteAddress) || '',
        nowMs(),
      )
  } catch (e) {
    console.error('[audit] write failed:', e.message)
  }
}

/** 审计日志列表（倒序，带用户名），支持分页与筛选。 */
export function listAudit(opts = {}) {
  const limit = Math.min(Math.max(parseInt(opts.limit, 10) || 100, 1), 500)
  const offset = Math.max(parseInt(opts.offset, 10) || 0, 0)
  const where = []
  const args = []
  if (opts.action) {
    where.push('a.action = ?')
    args.push(opts.action)
  }
  if (opts.from) {
    where.push('a.created_at >= ?')
    args.push(Number(opts.from))
  }
  if (opts.to) {
    where.push('a.created_at <= ?')
    args.push(Number(opts.to))
  }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const total = getDb().prepare(`SELECT COUNT(*) AS c FROM audit_logs a ${whereSql}`).get(...args).c
  const rows = getDb()
    .prepare(
      `SELECT a.id, a.action, a.target, a.detail, a.ip, a.created_at, u.username
       FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
       ${whereSql}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...args, limit, offset)
  return {
    total,
    logs: rows.map((r) => {
      let detail = r.detail
      try {
        detail = detail != null ? JSON.parse(detail) : null
      } catch {
        /* 保持原字符串 */
      }
      return { ...r, detail }
    }),
  }
}
