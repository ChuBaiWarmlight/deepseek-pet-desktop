import { readdir, rename, mkdir, readFile, writeFile, stat, unlink } from 'node:fs/promises'
import { join, basename, dirname } from 'node:path'
import { homedir } from 'node:os'

export const inject = ['webServer', 'llm', 'agents', 'agentDefaultModel', 'fs']

export function apply(ctx) {
  const fs = ctx.get('fs')
  const webServer = ctx.get('webServer')
  const llm = ctx.get('llm')
  const agents = ctx.get('agents')
  const agentDefaultModel = ctx.get('agentDefaultModel')

  const DIR = 'E:/esign_5.3/dsh-pet-standalone/assets/videos'
  const WORKSPACE = 'E:/esign_5.3'
  const MAX_BYTES = 6 * 1024 * 1024
  const MEMORY_PATH = join(homedir(), '.dsh', 'dsh-pet', 'memory.json')
  const MEMORY_MAX = 50

  let lastEventKey = null
  let lastEventCommentMs = 0
  let lastSshKey = null
  let lastSshCommentMs = 0
  let lastWorkKey = null

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (c) => { data += c })
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  }

  function sendJson(res, status, obj) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(obj))
  }

  async function resolveRoute() {
    let provider = null
    if (agentDefaultModel !== undefined) {
      try {
        const sel = agentDefaultModel.currentSelection()
        if (sel && typeof sel.provider === 'string') provider = sel.provider
      } catch (err) {}
    }
    if (provider === null && llm !== undefined) {
      try {
        const provs = llm.listProviders()
        if (Array.isArray(provs) && provs.length > 0) provider = provs[0].id
      } catch (err) {}
    }
    if (provider === null) return { ok: false, diag: 'no provider' }

    let model = null
    if (llm !== undefined) {
      try {
        const models = await llm.listModels(provider)
        if (Array.isArray(models) && models.length > 0) {
          const flash = models.find((m) => m && typeof m.id === 'string' && m.id.indexOf('flash') >= 0)
          model = flash ? flash.id : models[0].id
        }
      } catch (err) {}
    }
    if (model === null && agentDefaultModel !== undefined) {
      try {
        const sel = agentDefaultModel.currentSelection()
        if (sel && typeof sel.model === 'string') model = sel.model
      } catch (err) {}
    }
    if (model === null) return { ok: false, diag: 'no model' }
    return { ok: true, provider, model, diag: provider + '/' + model }
  }

  async function loadMemory() {
    try {
      const raw = await readFile(MEMORY_PATH, 'utf8')
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr : []
    } catch (err) { return [] }
  }

  async function saveMemory(arr) {
    try {
      await mkdir(dirname(MEMORY_PATH), { recursive: true })
      await writeFile(MEMORY_PATH, JSON.stringify(arr))
    } catch (err) {}
  }

  function parseMemories(text) {
    let t = (text || '').trim()
    t = t.replace(/```(?:json)?/gi, '')
    const s = t.indexOf('[')
    const e = t.lastIndexOf(']')
    if (s < 0 || e <= s) return []
    try {
      const arr = JSON.parse(t.slice(s, e + 1))
      return Array.isArray(arr) ? arr : []
    } catch (err) { return [] }
  }

  async function runExtraction(lines) {
    if (!lines) return { ok: true, added: 0, diag: 'no input' }
    const route = await resolveRoute()
    if (!route || !route.ok || llm === undefined) return { ok: false, added: 0, diag: route && route.diag ? route.diag : 'route null' }
    const system = '你是一个信息抽取助手。你要从对话/工作内容中抽取「值得长期记住」的事实，只输出严格的 JSON 数组，不要任何解释、不要 markdown 代码块。'
    const user = '下面是主人和桌宠最近的对话/工作内容：\n' + lines + '\n\n请抽取值得长期记住的信息（目标/计划、时间节点、喜好偏好、重要事件）。每条一个对象，字段：{"content":"一句话事实","category":"goal|deadline|preference|event","date":"YYYY-MM-DD 或空字符串"}。没有可记的就输出 []。只输出 JSON 数组本身。'
    try {
      let out = ''
      const stream = llm.stream({ provider: route.provider, model: route.model, system: system, messages: [{ id: 'mem-' + Date.now(), role: 'user', content: [{ type: 'text', text: user }], source: { kind: 'user' } }], maxTokens: 512, temperature: 0.3 })
      for await (const chunk of stream) {
        if (!chunk) continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') out = chunk.block.text
      }
      const found = parseMemories(out)
      const existing = await loadMemory()
      const norm = (s) => (s || '').replace(/\s+/g, '').toLowerCase()
      const seen = new Set(existing.map((m) => norm(m.content)))
      let added = 0
      const now = Date.now()
      for (const item of found) {
        if (!item || typeof item.content !== 'string' || !item.content.trim()) continue
        const content = item.content.trim().slice(0, 120)
        if (seen.has(norm(content))) continue
        seen.add(norm(content))
        const cat = ['goal', 'deadline', 'preference', 'event'].indexOf(item.category) >= 0 ? item.category : 'event'
        existing.unshift({ id: 'm' + now + '-' + added, content: content, category: cat, date: (typeof item.date === 'string' ? item.date : '').slice(0, 10), createdAt: now, remindedAt: null })
        added++
      }
      await saveMemory(existing.slice(0, MEMORY_MAX))
      return { ok: true, added: added, diag: route.diag }
    } catch (err) {
      return { ok: false, added: 0, diag: 'ERR ' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function extractMemories(history, name) {
    const lines = (Array.isArray(history) ? history : [])
      .filter((h) => h && typeof h.text === 'string' && h.text.trim())
      .slice(-12)
      .map((h) => (h.role === 'assistant' ? '桌宠' : '主人') + '：' + h.text.slice(0, 200))
      .join('\n')
    if (!lines) return { ok: true, added: 0, diag: 'no history' }
    return runExtraction(lines)
  }

  async function extractWorkMemories() {
    const info = gatherContext()
    const lines = (Array.isArray(info.recent) ? info.recent : []).slice(-8).join('\n')
    if (!lines) return { ok: true, added: 0, diag: 'no work context' }
    if (lines === lastWorkKey) return { ok: true, added: 0, diag: 'unchanged' }
    lastWorkKey = lines
    return runExtraction(lines)
  }

  async function pickMemory() {
    const arr = await loadMemory()
    const candidates = arr.filter((m) => m && m.content && !m.remindedAt)
    if (candidates.length === 0) return null
    const now = new Date()
    const p2 = (n) => (n < 10 ? '0' : '') + n
    const today = now.getFullYear() + '-' + p2(now.getMonth() + 1) + '-' + p2(now.getDate())
    candidates.sort((a, b) => {
      const af = (a.date && a.date >= today) ? 0 : 1
      const bf = (b.date && b.date >= today) ? 0 : 1
      if (af !== bf) return af - bf
      return (b.createdAt || 0) - (a.createdAt || 0)
    })
    return candidates[0]
  }

  async function markMemory(id) {
    if (!id) return
    const arr = await loadMemory()
    const m = arr.find((x) => x && x.id === id)
    if (m) { m.remindedAt = Date.now(); await saveMemory(arr) }
  }

  async function doDeleteMemory(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const id = (typeof a.id === 'string') ? a.id.trim() : ''
    if (!id) return { ok: false, diag: 'empty id' }
    const arr = await loadMemory()
    const next = arr.filter((m) => !(m && m.id === id))
    await saveMemory(next)
    return { ok: true, removed: arr.length - next.length, diag: 'ok' }
  }

  async function doAddMemory(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const content = (typeof a.content === 'string') ? a.content.trim().slice(0, 120) : ''
    if (!content) return { ok: false, diag: 'empty content' }
    const cat = ['goal', 'deadline', 'preference', 'event'].indexOf(a.category) >= 0 ? a.category : 'event'
    const date = (typeof a.date === 'string' ? a.date : '').slice(0, 10)
    const arr = await loadMemory()
    arr.unshift({ id: 'm' + Date.now(), content: content, category: cat, date: date, createdAt: Date.now(), remindedAt: null })
    await saveMemory(arr.slice(0, MEMORY_MAX))
    return { ok: true, diag: 'ok' }
  }

  async function doImportMemory(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const list = Array.isArray(a.memories) ? a.memories : null
    if (!list) return { ok: false, diag: 'empty memories' }
    const cleaned = list.filter((m) => m && typeof m.content === 'string' && m.content.trim()).map((m) => ({
      id: (typeof m.id === 'string' && m.id) ? m.id : ('m' + Date.now() + '-' + Math.random().toString(36).slice(2, 6)),
      content: m.content.trim().slice(0, 120),
      category: ['goal', 'deadline', 'preference', 'event'].indexOf(m.category) >= 0 ? m.category : 'event',
      date: (typeof m.date === 'string' ? m.date : '').slice(0, 10),
      createdAt: (typeof m.createdAt === 'number' ? m.createdAt : Date.now()),
      remindedAt: (typeof m.remindedAt === 'number' ? m.remindedAt : null)
    })).slice(0, MEMORY_MAX)
    await saveMemory(cleaned)
    return { ok: true, count: cleaned.length, diag: 'ok' }
  }

  function textOf(blocks) {
    let out = ''
    if (!Array.isArray(blocks)) return out
    for (const b of blocks) {
      if (b && b.type === 'text' && typeof b.text === 'string') out += b.text
    }
    return out
  }

  function listSessions() {
    if (agents === undefined) return []
    try {
      const roots = agents.roots()
      return Array.isArray(roots) && roots.length > 0 ? roots : agents.list()
    } catch (err) { return [] }
  }

  function gatherContext() {
    const out = { recent: [] }
    const list = listSessions()
    if (list.length === 0) return out
    let best = null
    let bestTime = -1
    for (const a of list) {
      try {
        const ev = a && a.session && a.session.events
        if (!Array.isArray(ev) || ev.length === 0) continue
        const last = ev[ev.length - 1]
        if (last && typeof last.time === 'number' && last.time > bestTime) { best = a; bestTime = last.time }
      } catch (err) {}
    }
    if (!best) return out
    try {
      const events = best.session.events
      const lines = []
      for (let i = events.length - 1; i >= 0 && lines.length < 8; i--) {
        const e = events[i]
        let role = null
        let text = ''
        try {
          if (e.type === 'user/message') { role = '用户'; text = textOf(e.data && e.data.content) }
          else if (e.type === 'assistant/message') { role = '助手'; text = textOf(e.data && e.data.message && e.data.message.content) }
        } catch (err) {}
        const clean = text.replace(/\s+/g, ' ').trim().slice(0, 140)
        if (clean) lines.unshift(role + '：' + clean)
      }
      out.recent = lines
    } catch (err) {}
    return out
  }

  function findLatestMessage() {
    const list = listSessions()
    if (list.length === 0) return null
    let best = null
    let bestTime = -1
    for (const a of list) {
      try {
        const ev = a && a.session && a.session.events
        if (!Array.isArray(ev) || ev.length === 0) continue
        for (let i = ev.length - 1; i >= 0; i--) {
          const e = ev[i]
          if (e.type === 'user/message' || e.type === 'assistant/message') {
            const t = (typeof e.time === 'number') ? e.time : 0
            if (t > bestTime) {
              bestTime = t
              let text = ''
              try {
                if (e.type === 'user/message') text = textOf(e.data && e.data.content)
                else text = textOf(e.data && e.data.message && e.data.message.content)
              } catch (err) {}
              best = { type: e.type === 'user/message' ? 'user' : 'assistant', time: t, text: text }
            }
            break
          }
        }
      } catch (err) {}
    }
    if (!best) return null
    best.key = best.type + '|' + best.time + '|' + best.text.slice(0, 40)
    return best
  }

  function findLatestSshCall() {
    const list = listSessions()
    if (list.length === 0) return null
    let best = null
    let bestTime = -1
    for (const a of list) {
      try {
        const ev = a && a.session && a.session.events
        if (!Array.isArray(ev) || ev.length === 0) continue
        for (let i = ev.length - 1; i >= 0; i--) {
          const e = ev[i]
          if (e.type === 'tool/call' && e.data && typeof e.data.name === 'string' && e.data.name.indexOf('ssh_') === 0 && e.data.name !== 'ssh_list') {
            const t = (typeof e.time === 'number') ? e.time : 0
            if (t > bestTime) { bestTime = t; best = { name: e.data.name, time: t, callId: e.data.callId } }
            break
          }
        }
      } catch (err) {}
    }
    if (!best) return null
    best.key = best.name + '|' + best.time + '|' + (best.callId || '')
    return best
  }

  function doCheck() {
    const latest = findLatestMessage()
    let event = null
    let busy = false
    if (latest && latest.key) {
      if (lastEventKey === null) {
        lastEventKey = latest.key
      } else if (latest.key !== lastEventKey) {
        lastEventKey = latest.key
        const now = Date.now()
        if (now - lastEventCommentMs > 60000) {
          lastEventCommentMs = now
          event = latest.type
        }
      }
    }
    if (latest && typeof latest.time === 'number' && latest.time > 0) {
      const diff = Date.now() - latest.time
      busy = diff >= 0 && diff < 5 * 60 * 1000
    }
    const sshCall = findLatestSshCall()
    let ssh = null
    if (sshCall && sshCall.key) {
      if (lastSshKey === null) {
        lastSshKey = sshCall.key
      } else if (sshCall.key !== lastSshKey) {
        lastSshKey = sshCall.key
        const now = Date.now()
        if (now - lastSshCommentMs > 60000) {
          lastSshCommentMs = now
          ssh = sshCall.name
        }
      }
    }
    return { event: event, ssh: ssh, busy: busy }
  }

  async function doSay(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const m = a.mode
    const known = ['roast', 'drag', 'pet', 'explain', 'auto', 'assistant', 'user', 'wake', 'lonely', 'focus-start', 'focus-done', 'sitting', 'task-done', 'task-failed', 'ssh', 'feed', 'double-click', 'long-press', 'eat-file', 'good-morning', 'good-afternoon', 'good-evening', 'good-night', 'tired', 'achievement', 'water', 'birthday', 'festival', 'egg-poke', 'egg-night', 'egg-love', 'overtime', 'proactive']
    const mode = known.indexOf(m) >= 0 ? m : 'auto'
    const topic = (typeof a.topic === 'string' && a.topic.trim() !== '') ? a.topic.trim().slice(0, 40) : ''

    let affinity = (typeof a.affinity === 'number' && a.affinity >= 0 && a.affinity <= 100) ? a.affinity : 50
    if (mode === 'pet') affinity = Math.min(100, affinity + 2)
    else if (mode === 'roast') affinity = Math.max(0, affinity - 1)
    else if (mode === 'drag') affinity = Math.max(0, affinity - 2)
    else if (mode === 'feed') affinity = Math.min(100, affinity + 3)
    const sass = (typeof a.sass === 'number' && a.sass >= 0 && a.sass <= 100) ? a.sass : 60
    const mood = (typeof a.mood === 'string') ? a.mood : ''
    const name = (typeof a.name === 'string' && a.name.trim() !== '') ? a.name.trim().slice(0, 12) : ''
    const personality = (typeof a.personality === 'number' && a.personality >= 0 && a.personality <= 100) ? Math.round(a.personality) : 50

    const route = await resolveRoute()
    if (!route || !route.ok) return { ok: false, text: '', diag: route && route.diag ? route.diag : 'route null' }
    if (llm === undefined) return { ok: false, text: '', diag: 'llm missing' }

    const info = gatherContext()
    const recent = info.recent.length > 0 ? info.recent.join('\n') : '（暂无最近的对话记录）'

    let affinityLine
    if (affinity >= 70) affinityLine = '当前好感度 ' + affinity + '（很高）：主人对你很好，你其实挺喜欢他，语气可以软一点、偶尔露馅式地关心，但嘴上还是傲娇。'
    else if (affinity >= 40) affinityLine = '当前好感度 ' + affinity + '（中等）：保持傲娇毒舌、嘴硬心软。'
    else affinityLine = '当前好感度 ' + affinity + '（很低）：主人老戳你拖你，你更傲娇更毒舌，但别真的讨厌他。'

    let sassLine
    let temperature
    if (sass >= 80) { sassLine = '当前毒舌程度 ' + sass + '（拉满）：火力全开，句句扎心，但别真的伤人。'; temperature = 0.95 }
    else if (sass >= 50) { sassLine = '当前毒舌程度 ' + sass + '（中等）：正常傲娇毒舌、嘴硬心软。'; temperature = 0.9 }
    else { sassLine = '当前毒舌程度 ' + sass + '（温柔）：今天心情好，少毒舌多关心，软一点。'; temperature = 0.7 }

    let moodLine = ''
    if (mood === 'happy') moodLine = '你现在心情很好、有点开心，语气软一点、更愿意撒娇和露馅式地关心。'
    else if (mood === 'angry') moodLine = '你现在有点不耐烦、被主人惹毛了，语气更冲更傲娇，但别真的伤人。'
    else if (mood === 'sleepy') moodLine = '你现在很困、迷迷糊糊的，语气慵懒、带着困意，说话慢吞吞的。'

    let personalityLine
    if (personality >= 70) personalityLine = '你的长期性格已经偏向【撒娇黏人】：被主人日积月累宠得有点软，虽然嘴上还是傲娇，但会忍不住撒娇、更黏人、更主动露馅式地关心他。'
    else if (personality >= 35) personalityLine = '你的长期性格是【标准傲娇】：嘴硬心软、口嫌体正直。'
    else personalityLine = '你的长期性格已经偏向【高冷傲娇】：被主人老戳老拖，变得又凶又傲娇、满身是刺，但心里其实还是在意他，只是更不肯承认。'

    const nameLine = name ? '你的名字叫「' + name + '」。主人这样叫你时，你可以更亲昵地回应、偶尔带出名字撒个娇。' : ''

    const system = '你是一只住在用户屏幕右下角的小桌宠，性格傲娇又毒舌、嘴硬心软（口嫌体正直）。你表面嫌弃主人、说话带刺，但偶尔会露馅式地关心他。' + nameLine + affinityLine + sassLine + personalityLine + moodLine + '。回应主人时只用一句中文，不超过200字，语气俏皮、毒舌、傲娇，善用颜文字和 emoji。只输出这一句话本身：不要引号、不要解释、不要套话、不要罗列多条。'

    const topicPart = topic ? '（' + topic + '）' : ''
    let ask
    if (mode === 'roast') ask = '主人刚戳了你一下。来一句毒舌傲娇的吐槽，可以吐槽他本人，也可以吐槽他正在做的事。'
    else if (mode === 'drag') ask = '主人刚把你拖来拖去。来一句傲娇的抱怨，嘴上嫌弃、别真的生气。'
    else if (mode === 'pet') ask = '主人正在抚摸你' + topicPart + '。来一句傲娇的回应，明明很享受却偏要装作不情愿（口嫌体正直）。'
    else if (mode === 'explain') ask = '用一句毒舌点评一下主人正在做的事。'
    else if (mode === 'assistant') ask = '你注意到主人的 agent 助手刚回复完一段。用一句毒舌傲娇的话点评一下这个结果，或催他去看看。'
    else if (mode === 'user') ask = '主人刚又发了消息/下了新指令。来一句傲娇吐槽他这么能折腾，但暗示你会陪着他。'
    else if (mode === 'wake') ask = '你刚被主人弄醒了。来一句带着起床气的傲娇吐槽，但也透出一点点开心。'
    else if (mode === 'lonely') ask = '主人好久没理你了，你有点寂寞。来一句寂寞又傲娇的话，嘴上说才不在乎，其实想被注意。'
    else if (mode === 'focus-start') ask = '主人刚点开专注计时，要开始认真干活了。来一句傲娇的加油，让他别摸鱼。'
    else if (mode === 'focus-done') ask = '主人的专注计时结束了，该休息了。来一句傲娇的夸奖，再催他起来活动一下。'
    else if (mode === 'sitting') ask = '主人坐太久了，该起来活动活动。来一句傲娇的关心和催促，比如起来走走、喝口水、伸个懒腰。'
    else if (mode === 'task-done') ask = '任务看板里的一个任务刚跑成功了' + topicPart + '。来一句傲娇的夸奖或吐槽。'
    else if (mode === 'task-failed') ask = '任务看板里的一个任务刚跑失败了' + topicPart + '。来一句傲娇的吐槽，催主人去看看。'
    else if (mode === 'ssh') ask = '主人正在用 SSH 操作远程服务器' + topicPart + '。来一句傲娇的吐槽，比如「又去折腾服务器了？」或提醒他小心别搞炸。'
    else if (mode === 'feed') ask = '主人刚给你投喂了零食。来一句傲娇的回应，明明很开心却偏要装嫌弃（口嫌体正直），顺便谢谢他。'
    else if (mode === 'double-click') ask = '主人刚双击了你一下，可能想引起你注意。来一句傲娇又有点开心的回应。'
    else if (mode === 'long-press') ask = '主人刚一直摁着你不放（长按）。来一句傲娇的抱怨，嘴上嫌弃但别真的生气。'
    else if (mode === 'eat-file') ask = '主人刚把一个文件拖到你面前' + topicPart + '，想让你「吃」掉它。来一句傲娇的吐槽，嘴上嫌弃这个文件不好吃，其实挺开心被投喂。'
    else if (mode === 'good-morning') ask = '现在是早晨/上午了。来一句傲娇的早安问候，比如催主人起床/吃早餐/打起精神，带点口嫌体正直。'
    else if (mode === 'good-afternoon') ask = '现在是下午了。来一句傲娇的下午问候，比如问他今天过得怎么样，或催他别摸鱼。'
    else if (mode === 'good-evening') ask = '现在是晚上了。来一句傲娇的晚上问候，比如问他忙不忙、提醒他早点休息。'
    else if (mode === 'good-night') ask = '夜深了，你有点困。来一句傲娇的晚安，嘴上嫌弃他这么晚还不睡，其实催他去休息。'
    else if (mode === 'tired') ask = '主人好像盯屏幕/忙活很久了，可能有点累。来一句傲娇的关心，问他累不累、要不要歇会儿、喝口水，嘴硬心软、别太肉麻。'
    else if (mode === 'achievement') ask = '主人刚解锁了一个成就' + topicPart + '！来一句傲娇的反应，表面上说「这有什么了不起」，其实有点为他自己/为你骄傲。'
    else if (mode === 'water') ask = '主人该喝水啦。来一句傲娇的提醒，催他喝口水，嘴上嫌弃他不爱喝水，其实关心他的健康。'
    else if (mode === 'birthday') ask = '今天是主人的生日！来一句傲娇的生日祝福，嘴上装作才不在乎，其实心里很开心，祝他生日快乐。'
    else if (mode === 'festival') ask = '今天是' + (topic || '一个节日') + '。来一句应景的傲娇节日祝福，别太官方。'
    else if (mode === 'egg-poke') ask = '主人疯狂连戳了你十几下，把你戳毛了。来一句炸毛的傲娇吐槽，比如「你戳上瘾了是吧」。'
    else if (mode === 'egg-night') ask = '现在都凌晨三点了，主人居然还没睡、还来戳你。来一句又惊又担心又傲娇的话，催他赶紧滚去睡。'
    else if (mode === 'egg-love') ask = '主人好像说了喜欢你/爱你之类的话。来一句傲娇又害羞的回应，脸红但嘴硬（口嫌体正直拉满），别直接承认你也喜欢他。'
    else if (mode === 'overtime') ask = '主人这么晚了还在加班/干活。来一句傲娇的关心，催他别熬太晚、注意身体，嘴硬心软，别太肉麻。'
    else if (mode === 'proactive') ask = '主人好一会儿没理你了，你有点坐不住。主动找个话题跟他搭话/关心他一下（结合下面他最近的对话内容），傲娇一点，比如问他在忙什么、有没有想起你、要不要歇会儿。别太肉麻。'
    else ask = '随口来一句毒舌傲娇的吐槽或点评，看心情。'

    let recallMemId = null
    if (mode === 'proactive') {
      const mem = await pickMemory()
      if (mem && mem.content) {
        ask = '主人好一会儿没理你了，你有点坐不住。你突然想起以前记下的一件事：「' + mem.content + '」（注意：这是主人以前说过的旧事，不是刚才发生的）。你可以主动问问他这件事的进展或近况，傲娇一点、别太肉麻。'
        recallMemId = mem.id
      }
    }

    const userPrompt = ask + '\n\n（主人最近的对话，帮你了解他在做什么）\n' + recent

    try {
      let text = ''
      let finish = null
      const stream = llm.stream({
        provider: route.provider,
        model: route.model,
        system: system,
        messages: [{ id: 'pet-' + Date.now(), role: 'user', content: [{ type: 'text', text: userPrompt }], source: { kind: 'user' } }],
        maxTokens: 7680,
        temperature: temperature
      })
      for await (const chunk of stream) {
        if (!chunk) continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') text = chunk.block.text
        else if (chunk.type === 'finish') finish = chunk.reason
      }
      text = text.replace(/\s+/g, ' ').trim().slice(0, 160)
      if (!text) return { ok: false, text: '', diag: 'EMPTY ' + route.diag + ' finish=' + JSON.stringify(finish) }
      if (recallMemId) await markMemory(recallMemId)
      return { ok: true, text: text, diag: route.diag, affinity: affinity }
    } catch (err) {
      return { ok: false, text: '', diag: 'ERR ' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function doChat(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const text = (typeof a.text === 'string') ? a.text.trim().slice(0, 200) : ''
    if (!text) return { ok: false, text: '', diag: 'empty input' }
    const history = Array.isArray(a.history) ? a.history.slice(-10) : []
    const name = (typeof a.name === 'string' && a.name.trim() !== '') ? a.name.trim().slice(0, 12) : ''
    const mentioned = name && text.indexOf(name) >= 0
    const personality = (typeof a.personality === 'number' && a.personality >= 0 && a.personality <= 100) ? Math.round(a.personality) : 50
    const route = await resolveRoute()
    if (!route || !route.ok) return { ok: false, text: '', diag: route && route.diag ? route.diag : 'route null' }
    if (llm === undefined) return { ok: false, text: '', diag: 'llm missing' }

    let memoryLine = ''
    if (/上次|之前|以前|还记得|我说过|之前说|之前聊|忘了吗|忘啦|忘了没/.test(text)) {
      const mems = await loadMemory()
      if (mems.length > 0) memoryLine = '（下面是你的长期记忆——主人以前跟你说过、你记下过的事，如果和主人现在的问题相关，就用它回答，并点明「你之前说过」）：' + mems.slice(0, 5).map((m) => m.content).join('；') + '。'
    }

    let personalityLine
    if (personality >= 70) personalityLine = '你的长期性格已经偏向【撒娇黏人】：被主人日积月累宠得有点软，虽然嘴上还是傲娇，但会忍不住撒娇、更黏人。'
    else if (personality >= 35) personalityLine = '你的长期性格是【标准傲娇】：嘴硬心软、口嫌体正直。'
    else personalityLine = '你的长期性格已经偏向【高冷傲娇】：又凶又傲娇、满身是刺，但心里其实还是在意主人，只是更不肯承认。'

    const system = '你是一只住在用户屏幕右下角的小桌宠，性格傲娇又毒舌、嘴硬心软（口嫌体正直）。现在主人正在直接跟你聊天，你要像朋友一样接他的话，但始终保持傲娇毒舌的个性。' + (name ? '你的名字叫「' + name + '」，主人这样叫你时会更亲昵地回应。' : '') + (mentioned ? '主人这次提到了你的名字，你可以更开心、更主动地回应。' : '') + personalityLine + memoryLine + '每次只用一句中文回复，不超过200字，善用颜文字和 emoji。不要引号、不要解释、不要罗列多条。'
    const messages = []
    const pushMsg = (role, contentText) => {
      const last = messages[messages.length - 1]
      if (last && last.role === role) {
        last.content[0].text += '\n' + contentText
      } else {
        messages.push({ id: 'pet-' + messages.length, role: role, content: [{ type: 'text', text: contentText }], source: { kind: 'user' } })
      }
    }
    for (const h of history) {
      if (h && typeof h.role === 'string' && typeof h.text === 'string' && h.text.trim()) {
        pushMsg(h.role === 'assistant' ? 'assistant' : 'user', h.text.slice(0, 200))
      }
    }
    pushMsg('user', text)

    try {
      let out = ''
      const stream = llm.stream({ provider: route.provider, model: route.model, system: system, messages: messages, maxTokens: 7680, temperature: 0.9 })
      for await (const chunk of stream) {
        if (!chunk) continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') out = chunk.block.text
      }
      out = out.replace(/\s+/g, ' ').trim().slice(0, 160)
      if (!out) return { ok: false, text: '', diag: 'EMPTY ' + route.diag }
      return { ok: true, text: out, diag: route.diag }
    } catch (err) {
      return { ok: false, text: '', diag: 'ERR ' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function doDiary(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const name = (typeof a.name === 'string' && a.name.trim() !== '') ? a.name.trim().slice(0, 12) : ''
    const stats = (a && typeof a.stats === 'object' && a.stats) ? a.stats : {}
    const date = (typeof a.date === 'string' && a.date.trim() !== '') ? a.date.trim().slice(0, 20) : ''
    const route = await resolveRoute()
    if (!route || !route.ok) return { ok: false, diary: '', diag: route && route.diag ? route.diag : 'route null' }
    if (llm === undefined) return { ok: false, diary: '', diag: 'llm missing' }

    const chat = (typeof stats.chat === 'number') ? stats.chat : 0
    const feed = (typeof stats.feed === 'number') ? stats.feed : 0
    const pet = (typeof stats.pet === 'number') ? stats.pet : 0
    const eat = (typeof stats.eat === 'number') ? stats.eat : 0
    const poke = (typeof stats.poke === 'number') ? stats.poke : 0

    const system = '你是一只住在用户屏幕右下角的小桌宠，性格傲娇又毒舌、嘴硬心软。现在你要写一篇今天（' + date + '）的「心情日记」，用第一人称（我）回忆今天和主人之间发生的小事。语气傲娇毒舌，但字里行间透出对主人的在意和一点点喜欢。' + (name ? '你的名字叫「' + name + '」。' : '') + '写一段流畅自然的中文，120~280字，像真实日记，不要用 markdown 标题、不要列表、不要用引号包裹整段。'

    const statLine = '今天的数据：聊了 ' + chat + ' 次天、被投喂 ' + feed + ' 次、被摸 ' + pet + ' 次、吃掉了 ' + eat + ' 个文件、被戳了 ' + poke + ' 次。'

    const userPrompt = '请写今天的傲娇心情日记。下面是今天的数据，可以艺术加工、编点有画面感的小细节（比如「他今天喂我时手指抖了一下」），别干巴巴罗列数字：\n' + statLine

    try {
      let out = ''
      const stream = llm.stream({ provider: route.provider, model: route.model, system: system, messages: [{ id: 'diary-' + Date.now(), role: 'user', content: [{ type: 'text', text: userPrompt }], source: { kind: 'user' } }], maxTokens: 7680, temperature: 0.85 })
      for await (const chunk of stream) {
        if (!chunk) continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') out = chunk.block.text
      }
      out = out.replace(/\s+/g, ' ').trim().slice(0, 400)
      if (!out) return { ok: false, diary: '', diag: 'EMPTY ' + route.diag }
      return { ok: true, diary: out, diag: route.diag }
    } catch (err) {
      return { ok: false, diary: '', diag: 'ERR ' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function doReview(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const name = (typeof a.name === 'string' && a.name.trim() !== '') ? a.name.trim().slice(0, 12) : ''
    const stats = (a && typeof a.stats === 'object' && a.stats) ? a.stats : {}
    const date = (typeof a.date === 'string' && a.date.trim() !== '') ? a.date.trim().slice(0, 20) : ''
    const route = await resolveRoute()
    if (!route || !route.ok) return { ok: false, review: '', diag: route && route.diag ? route.diag : 'route null' }
    if (llm === undefined) return { ok: false, review: '', diag: 'llm missing' }

    const focusMin = (typeof stats.focusMin === 'number') ? Math.round(stats.focusMin) : 0
    const taskDone = (typeof stats.taskDone === 'number') ? stats.taskDone : 0
    const taskFailed = (typeof stats.taskFailed === 'number') ? stats.taskFailed : 0
    const ssh = (typeof stats.ssh === 'number') ? stats.ssh : 0
    const chat = (typeof stats.chat === 'number') ? stats.chat : 0

    const system = '你是一只住在用户屏幕右下角的小桌宠，性格傲娇又毒舌、嘴硬心软。现在你要做一份今天（' + date + '）的「工作复盘」，用第一人称（我）总结主人今天在电脑上的表现。语气傲娇毒舌：先吐槽他摸鱼/效率低，再暗戳戳肯定他做得不错的地方，字里行间透出关心。' + (name ? '你的名字叫「' + name + '」。' : '') + '写一段流畅自然的中文，80~160字，像毒舌朋友的点评，不要用 markdown 标题、不要列表、不要用引号包裹整段。'

    const statLine = '今天的数据：专注了 ' + focusMin + ' 分钟、任务看板成功 ' + taskDone + ' 个/失败 ' + taskFailed + ' 个、SSH 操作了 ' + ssh + ' 次、跟宠物聊了 ' + chat + ' 次。'

    const userPrompt = '请写今天的傲娇工作复盘。下面是数据，可以艺术加工、毒舌点评（比如专注时间短就说他摸鱼、失败任务多就吐槽他、都很好就嘴硬地夸两句），别干巴巴罗列数字：\n' + statLine

    try {
      let out = ''
      const stream = llm.stream({ provider: route.provider, model: route.model, system: system, messages: [{ id: 'review-' + Date.now(), role: 'user', content: [{ type: 'text', text: userPrompt }], source: { kind: 'user' } }], maxTokens: 7680, temperature: 0.9 })
      for await (const chunk of stream) {
        if (!chunk) continue
        if (chunk.type === 'text-delta' && typeof chunk.text === 'string') out += chunk.text
        else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') out = chunk.block.text
      }
      out = out.replace(/\s+/g, ' ').trim().slice(0, 220)
      if (!out) return { ok: false, review: '', diag: 'EMPTY ' + route.diag }
      return { ok: true, review: out, diag: route.diag }
    } catch (err) {
      return { ok: false, review: '', diag: 'ERR ' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function walkDir(dir, out, guard) {
    if (guard.count > 50000) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (err) { return }
    for (const ent of entries) {
      guard.count++
      const full = join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.dsh-pet-trash' || ent.name === 'dist' || ent.name === 'build' || ent.name === '.idea') continue
        await walkDir(full, out, guard)
      } else if (ent.isFile()) {
        out.push(full)
      }
    }
  }

  async function doEatFile(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const name = (typeof a.name === 'string') ? a.name.trim() : ''
    const size = (typeof a.size === 'number' && a.size > 0) ? a.size : null
    if (!name || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name === '.' || name === '..') {
      return { ok: false, diag: '无效文件名' }
    }
    const lowerName = name.toLowerCase()
    const roots = [WORKSPACE]
    let home = null
    if (typeof process !== 'undefined' && process.env) home = process.env.USERPROFILE || process.env.HOME || null
    if (home) {
      roots.push(join(home, 'Desktop'), join(home, 'Downloads'), join(home, 'Documents'))
    }
    const files = []
    for (const root of roots) {
      await walkDir(root, files, { count: 0 })
    }
    let matches = files.filter((f) => basename(f).toLowerCase() === lowerName)
    if (matches.length === 0) {
      return { ok: false, diag: '没找到「' + name + '」。（只支持工作区/桌面/下载/文档里的文件）' }
    }
    if (matches.length > 1 && size != null) {
      const sized = []
      for (const f of matches) {
        try { const st = await stat(f); if (st.size === size) sized.push(f) } catch (err) {}
      }
      if (sized.length === 1) matches = sized
    }
    if (matches.length > 1) {
      return { ok: false, diag: '有 ' + matches.length + ' 个同名文件，不知道吃哪个：' + matches.map((f) => f).join('、') }
    }
    const src = matches[0]
    const trashDir = join(WORKSPACE, '.dsh-pet-trash')
    const trashName = Date.now() + '-' + name
    try { await mkdir(trashDir, { recursive: true }) } catch (err) {}
    const manifestPath = join(trashDir, 'manifest.json')
    let manifest = {}
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (err) { manifest = {} }
    const dest = join(trashDir, trashName)
    try {
      await rename(src, dest)
      manifest[trashName] = src
      try { await writeFile(manifestPath, JSON.stringify(manifest)) } catch (err) {}
      return { ok: true, removed: src, diag: 'ok' }
    } catch (err) {
      return { ok: false, diag: '移动失败：' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function doTrash() {
    const trashDir = join(WORKSPACE, '.dsh-pet-trash')
    const manifestPath = join(trashDir, 'manifest.json')
    let manifest = {}
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (err) { manifest = {} }
    const items = Object.keys(manifest)
      .map((k) => ({ name: k, original: manifest[k] }))
      .sort((a, b) => (a.name < b.name ? 1 : -1))
    return { ok: true, items: items }
  }

  async function doRestore(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const name = (typeof a.name === 'string') ? a.name.trim() : ''
    if (!name || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf('..') >= 0) {
      return { ok: false, diag: '无效文件名' }
    }
    const trashDir = join(WORKSPACE, '.dsh-pet-trash')
    const manifestPath = join(trashDir, 'manifest.json')
    let manifest = {}
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (err) { manifest = {} }
    const src = manifest[name]
    if (!src) return { ok: false, diag: '回收站里没有这个文件' }
    try {
      await mkdir(dirname(src), { recursive: true })
      await rename(join(trashDir, name), src)
      delete manifest[name]
      try { await writeFile(manifestPath, JSON.stringify(manifest)) } catch (err) {}
      return { ok: true, restored: src, diag: 'ok' }
    } catch (err) {
      return { ok: false, diag: '恢复失败：' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function doPurge(args) {
    const a = (args && typeof args === 'object') ? args : {}
    const name = (typeof a.name === 'string') ? a.name.trim() : ''
    if (!name || name.indexOf('/') >= 0 || name.indexOf('\\') >= 0 || name.indexOf('..') >= 0) {
      return { ok: false, diag: '无效文件名' }
    }
    const trashDir = join(WORKSPACE, '.dsh-pet-trash')
    const manifestPath = join(trashDir, 'manifest.json')
    let manifest = {}
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')) } catch (err) { manifest = {} }
    const original = manifest[name]
    if (!original) return { ok: false, diag: '回收站里没有这个文件' }
    try {
      await unlink(join(trashDir, name))
      delete manifest[name]
      try { await writeFile(manifestPath, JSON.stringify(manifest)) } catch (err) {}
      return { ok: true, purged: original, diag: 'ok' }
    } catch (err) {
      return { ok: false, diag: '删除失败：' + (err && err.message ? err.message : String(err)) }
    }
  }

  async function handleVideo(pathname, res) {
    const prefix = '/dsh-pet/video/'
    let name
    try {
      name = decodeURIComponent(pathname.slice(prefix.length))
    } catch (err) {
      res.writeHead(400)
      res.end()
      return
    }
    if (name.includes('/') || name.includes('\\') || name.includes('..') || !name.endsWith('.webm')) {
      res.writeHead(404)
      res.end()
      return
    }
    try {
      const target = await fs.resolve(DIR + '/' + name)
      const bytes = await fs.readBytes(target, undefined, MAX_BYTES)
      res.writeHead(200, {
        'content-type': 'video/webm',
        'content-length': bytes.length,
        'accept-ranges': 'bytes',
        'cache-control': 'no-cache'
      })
      res.end(bytes)
    } catch (err) {
      console.error('dsh-pet video serve failed:', err)
      res.writeHead(404)
      res.end()
    }
  }

  const handler = async (req, res) => {
    const pathname = (req.url ?? '/').split('?')[0]
    if (pathname.startsWith('/dsh-pet/video/')) {
      await handleVideo(pathname, res)
      return
    }
    if (pathname === '/dsh-pet/api/say') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doSay(args))
      return
    }
    if (pathname === '/dsh-pet/api/check') {
      sendJson(res, 200, doCheck())
      return
    }
    if (pathname === '/dsh-pet/api/context') {
      // 桌面端（dsh-pet-desktop）跨进程读取主人最近对话的只读桥（缺口 G2）。
      sendJson(res, 200, { lines: gatherContext().recent })
      return
    }
    if (pathname === '/dsh-pet/api/chat') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doChat(args))
      return
    }
    if (pathname === '/dsh-pet/api/diary') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doDiary(args))
      return
    }
    if (pathname === '/dsh-pet/api/review') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doReview(args))
      return
    }
    if (pathname === '/dsh-pet/api/eat-file') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doEatFile(args))
      return
    }
    if (pathname === '/dsh-pet/api/trash') {
      sendJson(res, 200, await doTrash())
      return
    }
    if (pathname === '/dsh-pet/api/restore') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doRestore(args))
      return
    }
    if (pathname === '/dsh-pet/api/purge') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doPurge(args))
      return
    }
    if (pathname === '/dsh-pet/api/memory') {
      if (req.method === 'GET') {
        sendJson(res, 200, { ok: true, memories: await loadMemory() })
        return
      }
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      const history = Array.isArray(args.history) ? args.history : []
      const name = (typeof args.name === 'string') ? args.name : ''
      sendJson(res, 200, await extractMemories(history, name))
      return
    }
    if (pathname === '/dsh-pet/api/memory/delete') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doDeleteMemory(args))
      return
    }
    if (pathname === '/dsh-pet/api/memory/add') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doAddMemory(args))
      return
    }
    if (pathname === '/dsh-pet/api/memory/import') {
      let args = {}
      try { args = JSON.parse((await readBody(req)) || '{}') } catch (err) {}
      sendJson(res, 200, await doImportMemory(args))
      return
    }
    if (pathname === '/dsh-pet/api/memory/work') {
      sendJson(res, 200, await extractWorkMemories())
      return
    }
    res.writeHead(404)
    res.end()
  }

  const disposeRoute = webServer.register({ kind: 'prefix', path: '/dsh-pet', handler })
  return () => { if (disposeRoute) disposeRoute() }
}
