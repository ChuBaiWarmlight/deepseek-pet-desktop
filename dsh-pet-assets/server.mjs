// dsh-pet-assets 服务入口：HTTP 路由分发。
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import {
  readConfig,
  sendJson,
  sendOk,
  sendErr,
  readBody,
  readJsonBody,
  nowMs,
} from './lib/util.js'
import { initDb } from './lib/db.js'
import {
  ensureAdminUser,
  createSession,
  getSessionUser,
  revokeUserSessions,
  setSessionCookie,
  clearSessionCookie,
  verifyPassword,
  hashPassword,
  parseCookies,
  COOKIE_NAME,
} from './lib/auth.js'
import { audit, listAudit } from './lib/audit.js'
import { buildManifest } from './lib/manifest.js'
import {
  listResources,
  stats,
  uploadResource,
  deleteResource,
  patchResource,
  rebuild,
  listTrash,
  restoreResource,
  purgeResource,
  healthCheck,
  backfillTrashed,
} from './lib/resources.js'
import { serveVideo, serveFile } from './lib/static.js'
import { enqueueCommand, popPending, markDone, listCommands, upsertDevice, listDevices, pairDevice, unpairDevice, verifyDeviceToken } from './lib/pet.js'
import { getSync, putSync } from './lib/sync.js'
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, tickSchedules } from './lib/schedule.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.join(__dirname, 'dist')

const cfg = readConfig()
const db = initDb(cfg.dbPath)

// 一次性回填：区分历史数据中的"回收站"与"下线"（按文件是否仍在 videos/ 目录判断）。
if (!db.prepare("SELECT value FROM settings WHERE key = 'trash_backfill_v3'").get()) {
  const fixed = backfillTrashed(cfg)
  db.prepare("INSERT INTO settings (key, value) VALUES ('trash_backfill_v3', '1')").run()
  if (fixed) console.log('[init] 回收站语义回填：', fixed, '条')
}

// 首启创建管理员并打印初始密码
const initialPassword = ensureAdminUser()
if (initialPassword) {
  const initFile = path.join(path.dirname(cfg.dbPath), 'initial-admin.txt')
  fs.writeFileSync(initFile, `username: admin\npassword: ${initialPassword}\n`, 'utf8')
  try {
    fs.chmodSync(initFile, 0o600)
  } catch {}
  console.log('================================================')
  console.log('  dsh-pet-assets 首次初始化')
  console.log('  管理员账号: admin')
  console.log('  初始密码:   ' + initialPassword)
  console.log('  （已写入 ' + initFile + '，首登后请改密）')
  console.log('================================================')
}

const startedAt = nowMs()

// 启动时扫描资源目录入库（匿名，无审计）
try {
  const r = rebuild(cfg, null, null)
  if (r.added || r.updated || r.removed) {
    console.log('[init] 资源索引：新增', r.added, '更新', r.updated, '下线', r.removed)
  }
} catch (e) {
  console.error('[init] 资源扫描失败:', e.message)
}

/** 认证检查：未登录回 401 并返回 null。 */
function authUser(req, res) {
  const user = getSessionUser(req)
  if (!user) sendErr(res, 401, 'unauthorized')
  return user
}

function publicFile(pathname) {
  let rel
  if (pathname === '/' || pathname === '') rel = 'index.html'
  else rel = pathname.replace(/^\/+/, '')
  const full = path.resolve(PUBLIC_DIR, rel)
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) return null
  return full
}

async function handleLogin(req, res) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return sendErr(res, 400, 'invalid json')
  }
  const username = String(body.username || '').trim()
  const password = String(body.password || '')
  if (!username || !password) return sendErr(res, 400, 'username and password required')
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || user.disabled || !verifyPassword(password, user.password_hash)) {
    audit(null, 'login_failed', username, null, req)
    return sendErr(res, 401, 'invalid credentials')
  }
  const token = createSession(user.id, req)
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowMs(), user.id)
  setSessionCookie(res, token)
  audit(user.id, 'login', null, null, req)
  sendOk(res, { mustChangePassword: !!user.must_change_password })
}

async function handleChangePassword(req, res, user) {
  let body
  try {
    body = await readJsonBody(req)
  } catch {
    return sendErr(res, 400, 'invalid json')
  }
  const oldPassword = String(body.oldPassword || '')
  const newPassword = String(body.newPassword || '')
  if (!oldPassword || !newPassword) return sendErr(res, 400, 'oldPassword and newPassword required')
  if (newPassword.length < 8) return sendErr(res, 400, 'new password too short (>= 8)')
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  if (!verifyPassword(oldPassword, row.password_hash)) return sendErr(res, 401, 'old password incorrect')
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    hashPassword(newPassword),
    user.id,
  )
  revokeUserSessions(user.id)
  audit(user.id, 'change_password', null, null, req)
  sendOk(res, { reLogin: true })
}

function handleUpload(req, res, user) {
  const url = new URL(req.url, 'http://localhost')
  const category = url.searchParams.get('category') || ''
  const rawName = req.headers['x-file-name']
  if (!rawName) return sendErr(res, 400, 'missing X-File-Name header')
  let name
  try {
    name = decodeURIComponent(String(rawName))
  } catch {
    return sendErr(res, 400, 'invalid file name')
  }
  readBody(req, 6 * 1024 * 1024)
    .then((data) => {
      const result = uploadResource(cfg, name, data, category, user, req)
      if (result.status) return sendErr(res, result.status, result.error)
      sendOk(res, result)
    })
    .catch((e) => sendErr(res, 400, e.message || 'bad request'))
}

const server = http.createServer((req, res) => {
  const rawUrl = req.url || '/'
  const url = new URL(rawUrl, 'http://localhost')
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return sendErr(res, 400, 'invalid url encoding')
  }
  const method = req.method || 'GET'

  if (method === 'GET') {
    if (pathname === '/api/health') {
      const m = buildManifest()
      return sendOk(res, {
        service: 'dsh-pet-assets',
        version: '0.1.0',
        assetCount: m.items.length,
        totalBytes: m.items.reduce((a, i) => a + i.size, 0),
        startedAt,
      })
    }
    if (pathname === '/api/manifest') return sendJson(res, 200, buildManifest())
    if (pathname === '/api/pet/sync') {
      const result = getSync(req.headers['x-sync-code'])
      if (result.status) return sendErr(res, result.status, result.error)
      return sendOk(res, result)
    }
    if (pathname === '/api/manifest/version') {
      const m = buildManifest()
      return sendOk(res, {
        version: m.version,
        assetCount: m.items.length,
        totalBytes: m.items.reduce((a, i) => a + i.size, 0),
      })
    }
    if (pathname.startsWith('/assets/videos/')) {
      const name = url.pathname.slice('/assets/videos/'.length)
      return serveVideo(cfg, req, res, name)
    }
    if (pathname === '/api/auth/me') {
      const user = getSessionUser(req)
      if (!user) return sendErr(res, 401, 'unauthorized')
      return sendOk(res, { username: user.username, role: user.role })
    }
    if (pathname === '/api/resources') {
      const user = authUser(req, res)
      if (!user) return
      const items = listResources()
      const st = stats()
      return sendOk(res, { items, stats: st })
    }
    // 桌宠轮询待执行命令（需设备 token，M-05 收口匿名遥控；M-02 按设备定向）
    if (pathname === '/api/pet/poll') {
      const device = verifyDeviceToken(req)
      if (!device) return sendErr(res, 401, 'device unauthorized')
      return sendOk(res, { commands: popPending(device.device_id) })
    }
    // 命令历史（管理员控制台）
    if (pathname === '/api/pet/commands') {
      const user = authUser(req, res)
      if (!user) return
      return sendOk(res, { commands: listCommands() })
    }
    // 宠物设备列表（管理平台「宠物」页，管理员）
    if (pathname === '/api/pets') {
      const user = authUser(req, res)
      if (!user) return
      return sendOk(res, { devices: listDevices() })
    }
    // 定时任务列表（管理员）
    if (pathname === '/api/schedules') {
      const user = authUser(req, res)
      if (!user) return
      return sendOk(res, { schedules: listSchedules() })
    }
    // 审计日志（管理员，支持分页/筛选）
    if (pathname === '/api/audit') {
      const user = authUser(req, res)
      if (!user) return
      return sendOk(res, listAudit({
        action: url.searchParams.get('action') || '',
        limit: parseInt(url.searchParams.get('limit'), 10) || 100,
        offset: parseInt(url.searchParams.get('offset'), 10) || 0,
        from: parseInt(url.searchParams.get('from'), 10) || 0,
        to: parseInt(url.searchParams.get('to'), 10) || 0,
      }))
    }
    // 回收站列表（管理员）
    if (pathname === '/api/trash') {
      const user = authUser(req, res)
      if (!user) return
      return sendOk(res, { items: listTrash() })
    }
    // 健康检查（管理员）
    if (pathname === '/api/health-check') {
      const user = authUser(req, res)
      if (!user) return
      return sendOk(res, healthCheck(cfg))
    }
    // public 静态页 / SPA fallback
    const f = publicFile(pathname)
    if (f && fs.existsSync(f)) return serveFile(req, res, f)
    if (pathname.startsWith('/api/')) return sendErr(res, 404, 'not found')
    const idx = path.join(PUBLIC_DIR, 'index.html')
    if (fs.existsSync(idx)) return serveFile(req, res, idx)
    return sendErr(res, 404, 'not found')
  }

  if (method === 'HEAD') {
    if (pathname.startsWith('/assets/videos/')) {
      const name = url.pathname.slice('/assets/videos/'.length)
      return serveVideo(cfg, req, res, name)
    }
    const f = publicFile(pathname)
    if (f && fs.existsSync(f)) return serveFile(req, res, f)
    res.writeHead(404)
    res.end()
    return
  }

  if (method === 'POST') {
    if (pathname === '/api/auth/login') return handleLogin(req, res)

    if (pathname === '/api/auth/logout') {
      const user = getSessionUser(req)
      if (user) {
        const token = parseCookies(req)[COOKIE_NAME]
        if (token) {
          const id = createHash('sha256').update(token).digest('hex')
          db.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ?').run(nowMs(), id)
          audit(user.id, 'logout', null, null, req)
        }
      }
      clearSessionCookie(res)
      return sendOk(res, {})
    }

    if (pathname === '/api/auth/change-password') {
      const user = authUser(req, res)
      if (!user) return
      return handleChangePassword(req, res, user)
    }

    if (pathname === '/api/rebuild') {
      const user = authUser(req, res)
      if (!user) return
      const result = rebuild(cfg, user, req)
      return sendOk(res, result)
    }

    if (pathname === '/api/resources') {
      const user = authUser(req, res)
      if (!user) return
      return handleUpload(req, res, user)
    }

    // 下发遥控命令（管理员）；支持 deviceIds 批量：逐设备生成一条定向命令
    if (pathname === '/api/pet/commands') {
      const user = authUser(req, res)
      if (!user) return
      return readJsonBody(req)
        .then((body) => {
          const ids = Array.isArray(body.deviceIds) && body.deviceIds.length
            ? body.deviceIds.map((d) => String(d).trim()).filter(Boolean)
            : [null]
          const created = []
          for (const deviceId of ids) {
            const result = enqueueCommand(body.type, body.payload, user, req, deviceId)
            if (result.status) return sendErr(res, result.status, result.error)
            created.push(result)
          }
          return sendOk(res, { created })
        })
        .catch((e) => sendErr(res, 400, e.message || 'bad request'))
    }

    // 定时任务创建（管理员）
    if (pathname === '/api/schedules') {
      const user = authUser(req, res)
      if (!user) return
      return readJsonBody(req)
        .then((body) => {
          const result = createSchedule(body)
          if (result.status) return sendErr(res, result.status, result.error)
          audit(user.id, 'schedule_create', body.cron, { type: body.type }, req)
          return sendOk(res, result)
        })
        .catch((e) => sendErr(res, 400, e.message || 'bad request'))
    }

    // 桌宠心跳上报（匿名，用于设备发现/遥测；poll/done 已收口鉴权，见下方）
    if (pathname === '/api/pet/heartbeat') {
      return readJsonBody(req)
        .then((body) => {
          const result = upsertDevice(body, req)
          if (result.status) return sendErr(res, result.status, result.error)
          return sendOk(res, result)
        })
        .catch((e) => sendErr(res, 400, e.message || 'bad request'))
    }

    // 多设备加密同步（同步码仅用于定位；payload 为客户端 AES-GCM 密文）
    if (pathname === '/api/pet/sync') {
      return readJsonBody(req, 2 * 1024 * 1024)
        .then((body) => {
          const result = putSync(body)
          if (result.status) return sendErr(res, result.status, result.error)
          return sendOk(res, result)
        })
        .catch((e) => sendErr(res, 400, e.message || 'bad request'))
    }

    // 桌宠回执（需设备 token）
    const doneMatch = pathname.match(/^\/api\/pet\/commands\/(\d+)\/done$/)
    if (doneMatch) {
      const device = verifyDeviceToken(req)
      if (!device) return sendErr(res, 401, 'device unauthorized')
      return sendOk(res, markDone(Number(doneMatch[1]), device.device_id))
    }

    // 设备配对（管理员）：生成一次性 token，明文仅本次返回
    const pairMatch = pathname.match(/^\/api\/pets\/([^/]+)\/pair$/)
    if (pairMatch) {
      const user = authUser(req, res)
      if (!user) return
      const result = pairDevice(pairMatch[1])
      if (result.status) return sendErr(res, result.status, result.error)
      audit(user.id, 'pair_device', pairMatch[1], null, req)
      return sendOk(res, result)
    }

    // 取消设备配对（管理员）
    const unpairMatch = pathname.match(/^\/api\/pets\/([^/]+)\/unpair$/)
    if (unpairMatch) {
      const user = authUser(req, res)
      if (!user) return
      const result = unpairDevice(unpairMatch[1])
      if (result.status) return sendErr(res, result.status, result.error)
      audit(user.id, 'unpair_device', unpairMatch[1], null, req)
      return sendOk(res, result)
    }

    // 回收站恢复（管理员）
    const restoreMatch = pathname.match(/^\/api\/trash\/(.+)\/restore$/)
    if (restoreMatch) {
      const user = authUser(req, res)
      if (!user) return
      const result = restoreResource(cfg, restoreMatch[1], user, req)
      if (result.status) return sendErr(res, result.status, result.error)
      return sendOk(res, result)
    }
  }

  if (method === 'DELETE' || method === 'PATCH') {
    // 定时任务更新/删除（管理员）
    const schedMatch = pathname.match(/^\/api\/schedules\/(\d+)$/)
    if (schedMatch) {
      const user = authUser(req, res)
      if (!user) return
      const id = Number(schedMatch[1])
      if (method === 'DELETE') {
        const result = deleteSchedule(id)
        if (result.status) return sendErr(res, result.status, result.error)
        audit(user.id, 'schedule_delete', String(id), null, req)
        return sendOk(res, result)
      }
      return readJsonBody(req)
        .then((body) => {
          const result = updateSchedule(id, body)
          if (result.status) return sendErr(res, result.status, result.error)
          audit(user.id, 'schedule_update', String(id), body, req)
          return sendOk(res, result)
        })
        .catch(() => sendErr(res, 400, 'invalid json'))
    }

    const prefix = '/api/resources/'
    if (pathname.startsWith(prefix)) {
      const user = authUser(req, res)
      if (!user) return
      const name = url.pathname.slice(prefix.length)
      if (method === 'DELETE') {
        const result = deleteResource(cfg, name, user, req)
        if (result.status) return sendErr(res, result.status, result.error)
        return sendOk(res, result)
      }
      readJsonBody(req)
        .then((body) => {
          const result = patchResource(cfg, name, body, user, req)
          if (result.status) return sendErr(res, result.status, result.error)
          sendOk(res, result)
        })
        .catch(() => sendErr(res, 400, 'invalid json'))
      return
    }

    // 回收站彻底删除（管理员）
    const trashPrefix = '/api/trash/'
    if (pathname.startsWith(trashPrefix) && method === 'DELETE') {
      const user = authUser(req, res)
      if (!user) return
      const name = url.pathname.slice(trashPrefix.length)
      const result = purgeResource(cfg, name, user, req)
      if (result.status) return sendErr(res, result.status, result.error)
      return sendOk(res, result)
    }
  }

  sendErr(res, 404, 'not found')
})

const host = cfg.host || '127.0.0.1'
const port = Number(process.env.PORT || cfg.port || 8787)
server.listen(port, host, () => {
  console.log('dsh-pet-assets listening on http://' + host + ':' + port)
  if (host !== '127.0.0.1' && host !== 'localhost') {
    console.log('  [WARN] 服务监听非回环地址 ' + host + '，已暴露到网络，请确认安全')
  }
})

// 定时任务扫描：启动即扫一次，之后每 30s 评估一次 cron，命中则生成遥控命令（分钟级去重）。
try {
  tickSchedules()
} catch (e) {
  console.error('[schedule] tick failed:', e.message)
}
setInterval(() => {
  try {
    tickSchedules()
  } catch (e) {
    console.error('[schedule] tick failed:', e.message)
  }
}, 30_000)
