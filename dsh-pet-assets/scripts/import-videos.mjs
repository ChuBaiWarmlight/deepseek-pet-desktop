#!/usr/bin/env node
/**
 * 批量导入 AI 生成的动作视频（豆包 / 即梦 / 可灵等）。
 *
 * 输入：MP4/MOV/WebM，角色居中、纯绿（或纯蓝）背景、固定机位。
 * 输出：640x360、24fps、带 alpha 的 VP9 WebM，写入资源平台视频目录。
 *
 * 用法示例：
 *   node scripts/import-videos.mjs --src .\\doubao --category act
 *   node scripts/import-videos.mjs --src .\\doubao --upload
 *   node scripts/import-videos.mjs --src .\\doubao --key-color 00B140 --upload
 *
 * 目录约定（推荐）：doubao/act/打哈欠.mp4、doubao/idle/呼吸.mp4
 * 文件名约定：`{category}__{动作名}.mp4`，可选 `@w120` 权重后缀。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const CATEGORIES = [
  'idle',
  'turn',
  'move',
  'click',
  'drag',
  'sleep',
  'wake',
  'focus',
  'celebrate',
  'stretch',
  'act',
]

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v'])

const VALUE_FLAGS = new Set([
  'src',
  'dest',
  'category',
  'weight',
  'size',
  'fps',
  'duration',
  'max-mb',
  'crf',
  'loop',
  'key-color',
  'key-similarity',
  'key-blend',
  'server',
  'user',
  'password',
  'ffmpeg',
  'ffprobe',
])

const BOOL_FLAGS = new Set([
  'no-key',
  'overwrite',
  'dry-run',
  'upload',
  'replace',
  'json',
  'help',
])

function usage() {
  console.log(`
豆包动作视频 → dsh-pet 资源

必填：
  --src <目录>            待处理视频目录（会递归扫描）

常用：
  --category <分类>       未从目录/文件名识别时的默认分类（默认 act）
  --dest <目录>           输出目录（默认 ~/.dsh-pet-assets/assets/videos）
  --upload                转码后直接上传到资源平台（需要管理员密码）
  --server <URL>          资源平台地址（默认 http://127.0.0.1:8787）
  --user <用户名>         资源平台账号（默认 admin）
  --password <密码>       管理员密码；也可用环境变量 DSH_ASSETS_PASSWORD
  --replace               上传遇到同名文件时先删除旧资源（进回收站）

画面：
  --size 640x360          输出尺寸（默认 640x360）
  --fps 24                输出帧率（默认 24）
  --duration 10           输出时长秒数（默认 10）
  --loop trim|boomerang|none
                          短素材循环方式（默认 trim）
  --key-color 00FF00      绿幕色，支持 00FF00 / 0x00B140 / #00FF00
  --key-similarity 0.16   抠像相似度（默认 0.16）
  --key-blend 0.06        抠像边缘混合（默认 0.06）
  --no-key                素材本身已带 alpha，跳过抠像

体积：
  --max-mb 5.5            单文件上限（平台硬限制 6MB）
  --crf 34                VP9 质量（越大越小，默认 34）

其他：
  --ffmpeg <路径>         指定 ffmpeg（也可用 FFMPEG_PATH）
  --ffprobe <路径>        指定 ffprobe（没有时自动用 ffmpeg 解析）
  --overwrite             覆盖输出目录里的同名文件
  --dry-run               只打印计划，不转码/上传
  --json                  以 JSON 输出结果
  -h, --help              显示帮助

目录约定：src/act/打哈欠.mp4、src/idle/呼吸.mp4。
文件名也支持：act__打哈欠.mp4、act__打哈欠@w120.mp4。
`)
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function camel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
}

function parseArgs(argv) {
  const args = {
    src: '',
    dest: path.join(os.homedir(), '.dsh-pet-assets', 'assets', 'videos'),
    category: 'act',
    weight: 100,
    size: '640x360',
    fps: 24,
    duration: 10,
    maxMb: 5.5,
    crf: 34,
    loop: 'trim',
    keyColor: '00FF00',
    keySimilarity: 0.16,
    keyBlend: 0.06,
    noKey: false,
    overwrite: false,
    dryRun: false,
    upload: false,
    replace: false,
    server: 'http://127.0.0.1:8787',
    user: 'admin',
    password: process.env.DSH_ASSETS_PASSWORD || '',
    ffmpeg: '',
    ffprobe: '',
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i]
    if (raw === '-h' || raw === '--help') {
      args.help = true
      continue
    }
    if (!raw.startsWith('--')) throw new Error(`未知参数：${raw}`)
    let key = raw.slice(2)
    let value
    const eq = key.indexOf('=')
    if (eq >= 0) {
      value = key.slice(eq + 1)
      key = key.slice(0, eq)
    }
    if (BOOL_FLAGS.has(key)) {
      args[camel(key)] = value === undefined ? true : value !== 'false'
      continue
    }
    if (!VALUE_FLAGS.has(key)) throw new Error(`未知参数：--${key}`)
    if (value === undefined) {
      value = argv[i + 1]
      i += 1
    }
    if (value === undefined || value.startsWith('--')) throw new Error(`--${key} 缺少值`)
    args[camel(key)] = value
  }

  args.weight = clamp(Number(args.weight) || 0, 0, 1000)
  args.fps = clamp(Number(args.fps) || 24, 8, 60)
  args.duration = clamp(Number(args.duration) || 10, 2, 60)
  args.maxMb = clamp(Number(args.maxMb) || 5.5, 1, 6)
  args.crf = clamp(Number(args.crf) || 34, 18, 55)
  args.keySimilarity = clamp(Number(args.keySimilarity) || 0.16, 0.01, 0.5)
  args.keyBlend = clamp(Number(args.keyBlend) || 0.06, 0, 0.3)
  args.keyColor = normalizeColor(args.keyColor)
  return args
}

function normalizeColor(value) {
  const hex = String(value || '').trim().replace(/^#/, '').replace(/^0x/i, '')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`--key-color 需要 6 位十六进制颜色：${value}`)
  return hex.toUpperCase()
}

function resolveTools(args) {
  const ffmpeg = discoverFfmpeg(args.ffmpeg)
  if (!ffmpeg) {
    throw new Error(
      '找不到 ffmpeg。请安装 ffmpeg，或用 --ffmpeg 指定路径，或设置 FFMPEG_PATH。\n' +
        '本机可用示例：--ffmpeg "C:\\Program Files (x86)\\Lenovo\\LegionZone\\2.0.29.9292\\SEGamingAI\\services\\editor\\ffmpeg.exe"',
    )
  }
  const ffprobe = discoverFfprobe(args.ffprobe, ffmpeg)
  return { ffmpeg, ffprobe }
}

function discoverFfmpeg(explicit) {
  if (explicit) return explicit
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH
  const fromPath = which('ffmpeg')
  if (fromPath) return fromPath
  const candidates = [
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'),
  ]
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate
  }
  // LegionZone 会附带一份精简 ffmpeg，作为本机兜底。
  const legion = 'C:\\Program Files (x86)\\Lenovo\\LegionZone'
  if (fs.existsSync(legion)) {
    for (const version of fs.readdirSync(legion)) {
      const candidate = path.join(legion, version, 'SEGamingAI', 'services', 'editor', 'ffmpeg.exe')
      if (fs.existsSync(candidate)) return candidate
    }
  }
  return ''
}

function discoverFfprobe(explicit, ffmpeg) {
  if (explicit) return explicit
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH
  const sibling = path.join(
    path.dirname(ffmpeg),
    process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe',
  )
  if (fs.existsSync(sibling)) return sibling
  return which('ffprobe')
}

function which(bin) {
  const cmd = process.platform === 'win32' ? 'where' : 'which'
  const r = spawnSync(cmd, [bin], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) return ''
  return String(r.stdout || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || ''
}

function walkVideos(dir) {
  const out = []
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.isFile() && VIDEO_EXTS.has(path.extname(entry.name).toLowerCase())) out.push(full)
    }
  }
  visit(dir)
  return out.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
}

function nearestCategory(parts) {
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    if (CATEGORIES.includes(parts[i])) return parts[i]
  }
  return ''
}

function sanitizeName(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 80)
}

function parseSourceMeta(file, root, args) {
  const rel = path.relative(root, file)
  const parts = rel.split(path.sep)
  let category = args.category
  let name = path.basename(file, path.extname(file))
  const prefixed = /^([a-z]+)__(.+)$/.exec(name)
  if (prefixed && CATEGORIES.includes(prefixed[1])) {
    category = prefixed[1]
    name = prefixed[2]
  } else {
    category = nearestCategory(parts) || category
  }
  let weight = args.weight
  const weighted = /@w(\d{1,4})$/.exec(name)
  if (weighted) {
    weight = clamp(Number(weighted[1]), 0, 1000)
    name = name.slice(0, weighted.index)
  }
  const display = sanitizeName(name) || sanitizeName(path.basename(file, path.extname(file))) || '未命名动作'
  return { category, name: display, weight }
}

function probeMedia(file, tools) {
  if (tools.ffprobe) {
    const r = spawnSync(
      tools.ffprobe,
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=width,height,pix_fmt:stream_tags=alpha_mode',
        '-of',
        'json',
        file,
      ],
      { encoding: 'utf8', windowsHide: true },
    )
    if (r.status === 0) {
      try {
        const data = JSON.parse(r.stdout || '{}')
        const stream = (data.streams || [])[0] || {}
        const duration = Number(data.format?.duration ?? stream.duration ?? 0)
        return {
          duration: Number.isFinite(duration) ? duration : 0,
          width: Number(stream.width) || 0,
          height: Number(stream.height) || 0,
          pixFmt: String(stream.pix_fmt || ''),
          alpha: String(stream.tags?.alpha_mode ?? '').trim() === '1',
        }
      } catch {
        // fall through to ffmpeg parsing
      }
    }
  }

  const r = spawnSync(tools.ffmpeg, ['-hide_banner', '-i', file], {
    encoding: 'utf8',
    windowsHide: true,
  })
  const text = `${r.stderr || ''}\n${r.stdout || ''}`
  const dm = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
  const duration = dm ? Number(dm[1]) * 3600 + Number(dm[2]) * 60 + Number(dm[3]) : 0
  const video = /Video:\s*([^\n]+)/.exec(text)?.[1] || ''
  const dims = /(\d{2,5})x(\d{2,5})/.exec(video)
  const pixFmt = /,\s*([a-z0-9_]+)\(/.exec(video)?.[1] || ''
  return {
    duration,
    width: dims ? Number(dims[1]) : 0,
    height: dims ? Number(dims[2]) : 0,
    pixFmt,
    alpha: /alpha_mode\s*:\s*1/i.test(text),
  }
}

function parseSize(size) {
  const m = /^(\d{2,5})x(\d{2,5})$/i.exec(String(size))
  if (!m) throw new Error(`--size 需要 WIDTHxHEIGHT：${size}`)
  return { width: Number(m[1]), height: Number(m[2]) }
}

function keyTypeFor(hex) {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return g >= r && g >= b ? 'green' : 'blue'
}

function buildVideoFilter(args, size) {
  const parts = []
  if (!args.noKey) {
    parts.push(`chromakey=0x${args.keyColor}:${args.keySimilarity}:${args.keyBlend}`)
    parts.push(`despill=type=${keyTypeFor(args.keyColor)}`)
  }
  parts.push(`scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease:flags=lanczos`)
  parts.push('format=rgba')
  parts.push(`pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black@0`)
  parts.push(`fps=${args.fps}`)
  parts.push('format=yuva420p')
  return parts.join(',')
}

function runFfmpeg(args, tools) {
  const r = spawnSync(tools.ffmpeg, args, {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (r.status !== 0) {
    const detail = String(r.stderr || r.stdout || '').trim().split(/\r?\n/).slice(-8).join('\n')
    throw new Error(detail || `ffmpeg 退出码 ${r.status}`)
  }
}

function encodeOne(source, output, meta, args, tools) {
  const size = parseSize(args.size)
  const sourceProbe = probeMedia(source, tools)
  const filter = buildVideoFilter(args, size)
  const maxBytes = Math.floor(args.maxMb * 1024 * 1024)
  const needsLoop = args.loop !== 'none' && sourceProbe.duration > 0 && sourceProbe.duration < args.duration - 0.05
  const inputArgs = needsLoop ? ['-stream_loop', '-1'] : []
  const codecArgs = [
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuva420p',
    '-b:v',
    '0',
    '-crf',
    String(args.crf),
    '-row-mt',
    '1',
    '-deadline',
    'good',
    '-cpu-used',
    '2',
    '-an',
  ]

  const attempts = [args.crf, Math.min(55, args.crf + 6), Math.min(60, args.crf + 12)]
  let lastError = ''
  for (const crf of attempts) {
    const currentCodec = codecArgs.map((v, i, arr) => (arr[i - 1] === '-crf' ? String(crf) : v))
    let ffArgs
    if (args.loop === 'boomerang') {
      const half = Math.max(1, args.duration / 2)
      const complex = `[0:v]${filter},trim=duration=${half.toFixed(3)},setpts=PTS-STARTPTS,split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[out]`
      ffArgs = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...inputArgs,
        '-i',
        source,
        '-filter_complex',
        complex,
        '-map',
        '[out]',
        '-t',
        String(args.duration),
        ...currentCodec,
        output,
      ]
    } else {
      ffArgs = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        ...inputArgs,
        '-i',
        source,
        '-t',
        String(args.duration),
        '-vf',
        filter,
        ...currentCodec,
        output,
      ]
    }
    try {
      runFfmpeg(ffArgs, tools)
      const bytes = fs.statSync(output).size
      if (bytes <= maxBytes) return { bytes, crf }
      lastError = `输出 ${(bytes / 1024 / 1024).toFixed(2)}MB，超过 --max-mb ${args.maxMb}`
    } catch (error) {
      lastError = error.message
      break
    }
  }
  throw new Error(lastError || '转码失败')
}

function uniqueOutput(dest, category, name, used, overwrite) {
  const base = `${category}__${name}`
  let candidate = `${base}.webm`
  let index = 2
  while (
    used.has(candidate.toLowerCase()) ||
    (!overwrite && fs.existsSync(path.join(dest, candidate)))
  ) {
    candidate = `${base}__v${index}.webm`
    index += 1
  }
  used.add(candidate.toLowerCase())
  return path.join(dest, candidate)
}

async function login(server, user, password) {
  const url = new URL('/api/auth/login', server)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`登录失败 HTTP ${res.status}：${text.slice(0, 200)}`)
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  const raw = setCookies[0] || res.headers.get('set-cookie') || ''
  const cookie = raw.split(';')[0]
  if (!cookie) throw new Error('登录成功但没有拿到会话 Cookie')
  return cookie
}

async function uploadOne(server, cookie, output, meta, args) {
  const base = server.replace(/\/+$/, '')
  const filename = path.basename(output)
  const url = `${base}/api/resources?category=${encodeURIComponent(meta.category)}`
  const headers = {
    cookie,
    'content-type': 'video/webm',
    'x-file-name': encodeURIComponent(filename),
  }
  let res = await fetch(url, { method: 'POST', headers, body: fs.readFileSync(output) })
  if (res.status === 409 && args.replace) {
    await fetch(`${base}/api/resources/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
      headers: { cookie },
    })
    res = await fetch(url, { method: 'POST', headers, body: fs.readFileSync(output) })
  }
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 409) throw new Error('平台已存在同名文件（可用 --replace 或改名）')
    throw new Error(`上传失败 HTTP ${res.status}：${text.slice(0, 200)}`)
  }
  if (meta.weight !== 100) {
    const patch = await fetch(`${base}/api/resources/${encodeURIComponent(filename)}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ weight: meta.weight }),
    })
    if (!patch.ok) {
      const text = await patch.text()
      throw new Error(`上传成功但设置权重失败 HTTP ${patch.status}：${text.slice(0, 200)}`)
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) return usage()
  if (!args.src) throw new Error('缺少 --src')
  const src = path.resolve(args.src)
  const dest = path.resolve(args.dest)
  if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) throw new Error(`目录不存在：${src}`)
  if (!CATEGORIES.includes(args.category)) throw new Error(`--category 不合法：${args.category}`)
  if (!['trim', 'boomerang', 'none'].includes(args.loop)) throw new Error('--loop 只能是 trim / boomerang / none')

  const files = walkVideos(src)
  if (!files.length) throw new Error(`没有找到视频文件：${src}`)
  if (!args.dryRun) fs.mkdirSync(dest, { recursive: true })

  const tools = resolveTools(args)
  console.log(`ffmpeg: ${tools.ffmpeg}`)
  console.log(`输入 ${files.length} 个文件 → ${dest}`)

  let cookie = ''
  if (args.upload && !args.dryRun) {
    if (!args.password) {
      throw new Error('--upload 需要管理员密码：设置 DSH_ASSETS_PASSWORD 或传 --password')
    }
    cookie = await login(args.server, args.user, args.password)
    console.log(`已登录资源平台：${args.server}`)
  }

  const used = new Set()
  const results = []
  let failed = 0

  for (let i = 0; i < files.length; i += 1) {
    const source = files[i]
    const meta = parseSourceMeta(source, src, args)
    const output = uniqueOutput(dest, meta.category, meta.name, used, args.overwrite)
    const rel = path.relative(src, source)
    console.log(`\n[${i + 1}/${files.length}] ${rel} → ${path.basename(output)} (${meta.category}, w${meta.weight})`)

    if (args.dryRun) {
      console.log(`  dry-run：跳过转码（${args.size}, ${args.fps}fps, ${args.duration}s, key=${args.noKey ? 'off' : args.keyColor}）`)
      results.push({ source, output, ...meta, dryRun: true })
      continue
    }

    try {
      const encoded = encodeOne(source, output, meta, args, tools)
      const probe = probeMedia(output, tools)
      if (probe.width !== parseSize(args.size).width || probe.height !== parseSize(args.size).height) {
        throw new Error(`输出尺寸异常：${probe.width}x${probe.height}`)
      }
      if (probe.duration > 0 && Math.abs(probe.duration - args.duration) > 0.8) {
        throw new Error(`输出时长异常：${probe.duration.toFixed(2)}s`)
      }
      if (!probe.alpha) {
        console.warn('  ! 未检测到 alpha_mode=1；请确认源素材是绿幕且没有使用 --no-key')
      }
      if (args.upload) await uploadOne(args.server, cookie, output, meta, args)
      const item = {
        source,
        output,
        category: meta.category,
        name: meta.name,
        weight: meta.weight,
        bytes: encoded.bytes,
        crf: encoded.crf,
        duration: probe.duration,
        alpha: probe.alpha,
        uploaded: args.upload,
      }
      results.push(item)
      console.log(
        `  ✓ ${(encoded.bytes / 1024 / 1024).toFixed(2)}MB, ${probe.duration.toFixed(1)}s, ` +
          `alpha=${probe.alpha ? 'yes' : 'NO'}${args.upload ? ', 已上传' : ''}`,
      )
    } catch (error) {
      failed += 1
      console.error(`  ✗ ${error.message}`)
    }
  }

  const totalBytes = results.reduce((sum, r) => sum + (r.bytes || 0), 0)
  console.log(`\n完成 ${results.length} 个，失败 ${failed} 个，总大小 ${(totalBytes / 1024 / 1024).toFixed(2)}MB`)
  if (!args.upload && !args.dryRun) {
    console.log('文件已写入资源目录；重启平台或点击「重建索引」即可入库。')
  }
  if (args.json) console.log(JSON.stringify(results, null, 2))
  if (failed) process.exitCode = 1
}

main().catch((error) => {
  console.error(`\n错误：${error.message}`)
  process.exit(1)
})
