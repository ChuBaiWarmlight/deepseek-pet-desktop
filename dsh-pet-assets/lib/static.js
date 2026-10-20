// 静态文件：视频（Range/ETag）+ public 资源。
import fs from 'node:fs'
import path from 'node:path'
import { sha256Hex } from './util.js'
import { safeVideoFile } from './resources.js'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webm': 'video/webm',
  '.json': 'application/json; charset=utf-8',
}

/** 内容 ETag 缓存：key 含路径/大小/mtime，同名文件更新后自动失效。 */
const etagCache = new Map()

function fileEtag(full, stat) {
  const key = `${full}|${stat.size}|${stat.mtimeMs}`
  const cached = etagCache.get(key)
  if (cached) return cached
  const etag = '"' + sha256Hex(fs.readFileSync(full)).slice(0, 16) + '"'
  if (etagCache.size > 512) etagCache.clear()
  etagCache.set(key, etag)
  return etag
}

/** If-None-Match 弱比较：支持列表、W/ 前缀与 `*`。 */
function etagMatches(header, etag) {
  if (!header) return false
  const strip = (v) => String(v || '').trim().replace(/^W\//i, '')
  const target = strip(etag)
  return String(header)
    .split(',')
    .map((v) => v.trim())
    .some((tag) => tag === '*' || strip(tag) === target)
}

/** 服务一个普通文件（public 页面等），支持 HEAD。 */
export function serveFile(req, res, fullPath, contentType) {
  let stat
  try {
    stat = fs.statSync(fullPath)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404)
    res.end()
    return
  }
  const ct = contentType || MIME[path.extname(fullPath).toLowerCase()] || 'application/octet-stream'
  const etag = fileEtag(fullPath, stat)
  const base = {
    'content-type': ct,
    'cache-control': 'no-cache',
    etag,
    'last-modified': stat.mtime.toUTCString(),
  }
  if (etagMatches(req && req.headers['if-none-match'], etag)) {
    res.writeHead(304, base)
    res.end()
    return
  }
  res.writeHead(200, { ...base, 'content-length': stat.size })
  if (req && req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(fullPath).pipe(res)
}

/** 服务视频，支持 Range 与 ETag。 */
export function serveVideo(cfg, req, res, name) {
  const file = safeVideoFile(name)
  if (!file) {
    res.writeHead(404)
    res.end()
    return
  }
  const root = path.resolve(path.join(cfg.assetsDir, 'videos')) + path.sep
  const full = path.resolve(path.join(cfg.assetsDir, 'videos', file))
  if (!full.startsWith(root)) {
    res.writeHead(404)
    res.end()
    return
  }
  let stat
  try {
    stat = fs.statSync(full)
  } catch {
    res.writeHead(404)
    res.end()
    return
  }
  if (!stat.isFile()) {
    res.writeHead(404)
    res.end()
    return
  }
  // ETag 取文件内容哈希（而非文件名），保证同名视频被替换后浏览器/WebView2 立即拿到新内容。
  const etag = fileEtag(full, stat)
  if (etagMatches(req.headers['if-none-match'], etag)) {
    res.writeHead(304, {
      'content-type': 'video/webm',
      'accept-ranges': 'bytes',
      etag,
      'cache-control': 'no-cache',
    })
    res.end()
    return
  }
  const base = {
    'content-type': 'video/webm',
    'accept-ranges': 'bytes',
    etag,
    'cache-control': 'no-cache',
  }
  const range = req.headers.range
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : 0
      let end = m[2] ? parseInt(m[2], 10) : stat.size - 1
      if (isNaN(start) || start < 0) start = 0
      if (isNaN(end) || end >= stat.size) end = stat.size - 1
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'content-range': `bytes */${stat.size}` })
        res.end()
        return
      }
      const length = end - start + 1
      res.writeHead(206, {
        ...base,
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': length,
      })
      if (req.method === 'HEAD') {
        res.end()
        return
      }
      fs.createReadStream(full, { start, end }).pipe(res)
      return
    }
  }
  res.writeHead(200, { ...base, 'content-length': stat.size })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(full).pipe(res)
}
