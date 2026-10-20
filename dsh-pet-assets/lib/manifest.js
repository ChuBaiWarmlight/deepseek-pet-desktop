// 从 DB 生成资源清单 + 版本（匿名读接口用）。
import { getDb } from './db.js'
import { sha256Hex, nowMs } from './util.js'

export function buildManifest() {
  const rows = getDb()
    .prepare(
      'SELECT name, file, size, sha256, mime, category, tags, weight FROM resources WHERE enabled = 1 AND trashed = 0 ORDER BY category, name',
    )
    .all()
  const items = rows.map((r) => {
    let tags = []
    try {
      tags = JSON.parse(r.tags || '[]')
    } catch {}
    return {
      name: r.name,
      file: r.file,
      url: '/assets/videos/' + encodeURIComponent(r.file),
      size: r.size,
      sha256: r.sha256,
      mime: r.mime,
      category: r.category,
      tags,
      weight: r.weight,
    }
  })
  const version = sha256Hex(items.map((i) => i.sha256).join('')).slice(0, 16)
  return { version, generatedAt: nowMs(), items }
}
