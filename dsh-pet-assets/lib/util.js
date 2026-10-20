// 通用工具：路径 / 配置 / JSON 响应 / body 读取 / 时间 / sha256。
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'

/** 展开路径开头的 `~`。 */
export function expandHome(p) {
  if (typeof p !== 'string') return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** 应用数据目录：`~/.dsh-pet-assets/`。 */
export function appDir() {
  return path.join(os.homedir(), '.dsh-pet-assets')
}

/** 读取配置，首启生成默认 config.json。 */
export function readConfig() {
  const dir = appDir()
  const file = path.join(dir, 'config.json')
  const defaults = {
    host: '127.0.0.1',
    port: 8787,
    assetsDir: path.join(dir, 'assets'),
    dbPath: path.join(dir, 'dsh-pet-assets.db'),
  }
  try {
    const raw = fs.readFileSync(file, 'utf8')
    const cfg = JSON.parse(raw)
    return { ...defaults, ...cfg }
  } catch {
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(file, JSON.stringify(defaults, null, 2), 'utf8')
    return defaults
  }
}

export function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

export function sendOk(res, obj) {
  sendJson(res, 200, { ok: true, ...obj })
}

export function sendErr(res, status, error) {
  sendJson(res, status, { ok: false, error: String(error || 'error') })
}

/** 读取请求体为 Buffer，限制大小。 */
export function readBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (c) => {
      total += c.length
      if (total > maxBytes) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** 读取 JSON 请求体，限制 1MB。 */
export async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const buf = await readBody(req, maxBytes)
  if (buf.length === 0) return {}
  return JSON.parse(buf.toString('utf8'))
}

export function nowMs() {
  return Date.now()
}

export function sha256Hex(bufOrStr) {
  return createHash('sha256').update(bufOrStr).digest('hex')
}
