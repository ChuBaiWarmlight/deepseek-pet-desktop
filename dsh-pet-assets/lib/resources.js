// 资源 CRUD + 磁盘对齐 + rebuild。
import fs from 'node:fs'
import path from 'node:path'
import { getDb } from './db.js'
import { nowMs, sha256Hex } from './util.js'
import { audit } from './audit.js'

export const CATEGORIES = [
  'idle', 'turn', 'move', 'click', 'drag', 'sleep', 'wake', 'focus', 'celebrate', 'stretch', 'act',
]
const MAX_UPLOAD = 6 * 1024 * 1024

export function videosDir(cfg) {
  return path.join(cfg.assetsDir, 'videos')
}

/** 安全文件名校验：仅 "xxx.webm"，无路径、无穿越。返回规范化文件名或 null。 */
export function safeVideoFile(name) {
  if (typeof name !== 'string') return null
  let decoded
  try {
    decoded = decodeURIComponent(name)
  } catch {
    return null
  }
  if (!decoded.endsWith('.webm')) return null
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..') || decoded.includes('\0')) return null
  if (decoded.length > 200) return null
  return decoded
}

export function listResources() {
  return getDb().prepare('SELECT * FROM resources WHERE trashed = 0 ORDER BY category, name').all()
}

export function stats() {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(size),0) AS totalBytes FROM resources WHERE enabled = 1 AND trashed = 0')
    .get()
  const byCat = getDb()
    .prepare('SELECT category, COUNT(*) AS count FROM resources WHERE enabled = 1 AND trashed = 0 GROUP BY category')
    .all()
  const byCategory = {}
  for (const r of byCat) byCategory[r.category] = r.count
  return { count: row.count, totalBytes: row.totalBytes, byCategory }
}

export function uploadResource(cfg, fileName, data, category, user, req) {
  const file = safeVideoFile(fileName)
  if (!file) return { status: 400, error: 'invalid file name (only .webm)' }
  if (category && !CATEGORIES.includes(category)) return { status: 400, error: 'invalid category' }
  if (data.length > MAX_UPLOAD) return { status: 413, error: 'file too large (max 6MB)' }
  const dir = videosDir(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const dest = path.join(dir, file)
  const dup = getDb().prepare('SELECT id FROM resources WHERE file = ?').get(file)
  if (dup) return { status: 409, error: 'file exists' }
  const tmp = dest + '.' + nowMs() + '.tmp'
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, dest)
  const size = data.length
  const sum = sha256Hex(data)
  const cat = category || 'act'
  const name = file.replace(/\.webm$/, '')
  getDb()
    .prepare(
      'INSERT INTO resources (name, file, size, sha256, mime, category, tags, enabled, weight, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,100,?,?)',
    )
    .run(name, file, size, sum, 'video/webm', cat, '[]', nowMs(), nowMs())
  audit(user.id, 'upload', file, { size, category: cat }, req)
  return { ok: true, item: { name, file, size, sha256: sum, mime: 'video/webm', category: cat, tags: [] } }
}

export function deleteResource(cfg, name, user, req) {
  const file = safeVideoFile(name)
  if (!file) return { status: 404, error: 'not found' }
  const row = getDb().prepare('SELECT * FROM resources WHERE file = ?').get(file)
  if (!row) return { status: 404, error: 'not found' }
  getDb().prepare('UPDATE resources SET enabled = 0, trashed = 1, updated_at = ? WHERE id = ?').run(nowMs(), row.id)
  const src = path.join(videosDir(cfg), file)
  const trashDir = path.join(cfg.assetsDir, '.trash')
  fs.mkdirSync(trashDir, { recursive: true })
  try {
    if (fs.existsSync(src)) fs.renameSync(src, path.join(trashDir, file + '.' + nowMs()))
  } catch (e) {
    console.error('[resources] move to trash failed:', e.message)
  }
  audit(user.id, 'delete', file, { size: row.size }, req)
  return { ok: true, removed: file }
}

export function patchResource(cfg, name, body, user, req) {
  const file = safeVideoFile(name)
  if (!file) return { status: 404, error: 'not found' }
  const row = getDb().prepare('SELECT * FROM resources WHERE file = ?').get(file)
  if (!row) return { status: 404, error: 'not found' }
  const b = body || {}
  const category = b.category && CATEGORIES.includes(b.category) ? b.category : row.category
  let tagsJson = row.tags
  if (b.tags !== undefined) {
    if (!Array.isArray(b.tags)) return { status: 400, error: 'tags must be array' }
    tagsJson = JSON.stringify(b.tags.map((t) => String(t).slice(0, 40)).slice(0, 20))
  }
  let finalFile = row.file
  let finalName = row.name
  if (typeof b.name === 'string' && b.name.trim() && b.name.trim() !== row.name) {
    const nf = safeVideoFile(b.name.trim() + '.webm')
    if (!nf) return { status: 400, error: 'invalid name' }
    const dup = getDb().prepare('SELECT id FROM resources WHERE file = ? AND id != ?').get(nf, row.id)
    if (dup) return { status: 409, error: 'name exists' }
    try {
      fs.renameSync(path.join(videosDir(cfg), row.file), path.join(videosDir(cfg), nf))
    } catch (e) {
      return { status: 500, error: 'rename failed: ' + e.message }
    }
    finalFile = nf
    finalName = nf.replace(/\.webm$/, '')
  }
  let finalEnabled = row.enabled
  if (typeof b.enabled === 'boolean') finalEnabled = b.enabled ? 1 : 0
  let finalWeight = row.weight
  if (typeof b.weight === 'number' && Number.isFinite(b.weight)) {
    finalWeight = Math.max(0, Math.min(1000, Math.round(b.weight)))
  }
  getDb()
    .prepare('UPDATE resources SET name = ?, file = ?, category = ?, tags = ?, enabled = ?, weight = ?, updated_at = ? WHERE id = ?')
    .run(finalName, finalFile, category, tagsJson, finalEnabled, finalWeight, nowMs(), row.id)
  audit(user ? user.id : null, 'patch', finalFile, { oldCategory: row.category, newCategory: category }, req)
  return { ok: true, item: { name: finalName, file: finalFile, category, tags: JSON.parse(tagsJson), enabled: !!finalEnabled, weight: finalWeight } }
}

export function rebuild(cfg, user, req) {
  const dir = videosDir(cfg)
  fs.mkdirSync(dir, { recursive: true })
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.webm'))
  const db = getDb()
  const existing = new Map(db.prepare('SELECT id, file, sha256 FROM resources').all().map((r) => [r.file, r]))
  let added = 0
  let updated = 0
  let removed = 0
  for (const f of files) {
    const full = path.join(dir, f)
    const stat = fs.statSync(full)
    const data = fs.readFileSync(full)
    const sum = sha256Hex(data)
    const rec = existing.get(f)
    if (!rec) {
      db.prepare(
        'INSERT INTO resources (name, file, size, sha256, mime, category, tags, enabled, weight, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,100,?,?)',
      ).run(f.replace(/\.webm$/, ''), f, stat.size, sum, 'video/webm', 'act', '[]', nowMs(), nowMs())
      added++
    } else if (rec.sha256 !== sum) {
      db.prepare('UPDATE resources SET sha256 = ?, size = ?, updated_at = ? WHERE id = ?').run(sum, stat.size, nowMs(), rec.id)
      updated++
    }
  }
  for (const [f, rec] of existing) {
    if (!files.includes(f)) {
      const r = db.prepare('SELECT enabled FROM resources WHERE id = ?').get(rec.id)
      if (r && r.enabled === 1) {
        db.prepare('UPDATE resources SET enabled = 0, updated_at = ? WHERE id = ?').run(nowMs(), rec.id)
        removed++
      }
    }
  }
  audit(user ? user.id : null, 'rebuild', null, { added, updated, removed }, req)
  return { ok: true, added, updated, removed }
}

// ---------------------------------------------------------------------------
// 回收站 / 健康检查（P0）
// ---------------------------------------------------------------------------

/** 回收站列表（enabled=0 的资源）。 */
export function listTrash() {
  return getDb().prepare('SELECT * FROM resources WHERE trashed = 1 ORDER BY updated_at DESC').all()
}

/** 从回收站恢复：把文件从 .trash 移回 videos，并重新上线。 */
export function restoreResource(cfg, name, user, req) {
  const file = safeVideoFile(name)
  if (!file) return { status: 404, error: 'not found' }
  const row = getDb().prepare('SELECT * FROM resources WHERE file = ? AND trashed = 1').get(file)
  if (!row) return { status: 404, error: 'not in trash' }
  let fileRestored = false
  const trashDir = path.join(cfg.assetsDir, '.trash')
  const dest = path.join(videosDir(cfg), file)
  if (fs.existsSync(trashDir) && !fs.existsSync(dest)) {
    const candidates = fs
      .readdirSync(trashDir)
      .filter((f) => f.startsWith(file + '.'))
      .sort()
      .reverse()
    for (const c of candidates) {
      try {
        fs.renameSync(path.join(trashDir, c), dest)
        fileRestored = true
        break
      } catch (e) {
        console.error('[resources] restore failed:', e.message)
      }
    }
  }
  getDb().prepare('UPDATE resources SET enabled = 1, trashed = 0, updated_at = ? WHERE id = ?').run(nowMs(), row.id)
  audit(user ? user.id : null, 'restore', file, { fileRestored }, req)
  return { ok: true, restored: file, fileRestored }
}

/** 彻底删除：清掉 .trash 里的文件与数据库记录。 */
export function purgeResource(cfg, name, user, req) {
  const file = safeVideoFile(name)
  if (!file) return { status: 404, error: 'not found' }
  const row = getDb().prepare('SELECT * FROM resources WHERE file = ? AND trashed = 1').get(file)
  if (!row) return { status: 404, error: 'not in trash' }
  const trashDir = path.join(cfg.assetsDir, '.trash')
  if (fs.existsSync(trashDir)) {
    for (const f of fs.readdirSync(trashDir)) {
      if (f.startsWith(file + '.')) {
        try {
          fs.unlinkSync(path.join(trashDir, f))
        } catch (e) {
          console.error('[resources] purge file failed:', e.message)
        }
      }
    }
  }
  getDb().prepare('DELETE FROM resources WHERE id = ?').run(row.id)
  audit(user ? user.id : null, 'purge', file, null, req)
  return { ok: true, purged: file }
}

/** 健康检查：检测上线资源的磁盘文件缺失 / 大小不符 / sha256 漂移。 */
export function healthCheck(cfg) {
  const rows = getDb().prepare('SELECT * FROM resources WHERE enabled = 1 AND trashed = 0').all()
  const issues = []
  for (const r of rows) {
    const full = path.join(videosDir(cfg), r.file)
    if (!fs.existsSync(full)) {
      issues.push({ file: r.file, problem: 'missing' })
      continue
    }
    const stat = fs.statSync(full)
    if (stat.size !== r.size) {
      issues.push({ file: r.file, problem: 'size_mismatch', expected: r.size, actual: stat.size })
      continue
    }
    const sum = sha256Hex(fs.readFileSync(full))
    if (sum !== r.sha256) {
      issues.push({ file: r.file, problem: 'sha_mismatch' })
    }
  }
  return { ok: issues.length === 0, issues, total: rows.length }
}

/** 一次性回填：老数据里 enabled=0 可能代表"回收站"或"下线"，按文件是否仍在 videos/ 目录区分。 */
export function backfillTrashed(cfg) {
  const dir = videosDir(cfg)
  const db = getDb()
  const rows = db.prepare('SELECT id, file, enabled FROM resources').all()
  let fixed = 0
  for (const r of rows) {
    const inVideos = fs.existsSync(path.join(dir, r.file))
    const want = r.enabled === 0 && !inVideos ? 1 : 0
    fixed += db.prepare('UPDATE resources SET trashed = ? WHERE id = ? AND trashed != ?').run(want, r.id, want).changes
  }
  return fixed
}
