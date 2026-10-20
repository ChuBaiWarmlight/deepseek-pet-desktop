return {
  apply(ctx) {
    const fs = ctx.get('fs')
    const webServer = ctx.get('webServer')
    const llm = ctx.get('llm')
    const agents = ctx.get('agents')
    const agentDefaultModel = ctx.get('agentDefaultModel')

    const DIR = 'E:/esign_5.3/dsh-pet-standalone/assets/videos'
    const MAX_BYTES = 6 * 1024 * 1024

    let lastEventKey = null
    let lastEventCommentMs = 0
    let lastSshKey = null
    let lastSshCommentMs = 0

    const handler = async (req, res) => {
      const pathname = (req.url ?? '/').split('?')[0]
      const prefix = '/dsh-pet/video/'
      if (!pathname.startsWith(prefix)) {
        res.writeHead(404)
        res.end()
        return
      }
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

    harness.handle('petCheck', async (args) => {
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
    })

    harness.handle('petSay', async (args) => {
      const a = (args && typeof args === 'object') ? args : {}
      const m = a.mode
      const known = ['roast', 'drag', 'pet', 'explain', 'auto', 'assistant', 'user', 'wake', 'lonely', 'focus-start', 'focus-done', 'sitting', 'task-done', 'task-failed', 'ssh']
      const mode = known.indexOf(m) >= 0 ? m : 'auto'
      const topic = (typeof a.topic === 'string' && a.topic.trim() !== '') ? a.topic.trim().slice(0, 40) : ''

      let affinity = (typeof a.affinity === 'number' && a.affinity >= 0 && a.affinity <= 100) ? a.affinity : 50
      if (mode === 'pet') affinity = Math.min(100, affinity + 2)
      else if (mode === 'roast') affinity = Math.max(0, affinity - 1)
      else if (mode === 'drag') affinity = Math.max(0, affinity - 2)

      const route = await resolveRoute()
      if (!route || !route.ok) return { ok: false, text: '', diag: route && route.diag ? route.diag : 'route null' }
      if (llm === undefined) return { ok: false, text: '', diag: 'llm missing' }

      const info = gatherContext()
      const recent = info.recent.length > 0 ? info.recent.join('\n') : '（暂无最近的对话记录）'

      let affinityLine
      if (affinity >= 70) affinityLine = '当前好感度 ' + affinity + '（很高）：主人对你很好，你其实挺喜欢他，语气可以软一点、偶尔露馅式地关心，但嘴上还是傲娇。'
      else if (affinity >= 40) affinityLine = '当前好感度 ' + affinity + '（中等）：保持傲娇毒舌、嘴硬心软。'
      else affinityLine = '当前好感度 ' + affinity + '（很低）：主人老戳你拖你，你更傲娇更毒舌，但别真的讨厌他。'

      const system = '你是一只住在用户屏幕右下角的小桌宠，性格傲娇又毒舌、嘴硬心软（口嫌体正直）。你表面嫌弃主人、说话带刺，但偶尔会露馅式地关心他。' + affinityLine + '。回应主人时只用一句中文，不超过100字，语气俏皮、毒舌、傲娇，善用颜文字和 emoji。只输出这一句话本身：不要引号、不要解释、不要套话、不要罗列多条。'

      const topicPart = topic ? '（' + topic + '）' : ''
      let ask
      if (mode === 'roast') ask = '主人刚戳了你一下。来一句毒舌傲娇的吐槽，可以吐槽他本人，也可以吐槽他正在做的事。'
      else if (mode === 'drag') ask = '主人刚把你拖来拖去。来一句傲娇的抱怨，嘴上嫌弃、别真的生气。'
      else if (mode === 'pet') ask = '主人正在抚摸你。来一句傲娇的回应，明明很享受却偏要装作不情愿（口嫌体正直）。'
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
      else ask = '随口来一句毒舌傲娇的吐槽或点评，看心情。'

      const userPrompt = ask + '\n\n（主人最近的对话，帮你了解他在做什么）\n' + recent

      try {
        let text = ''
        let finish = null
        const stream = llm.stream({
          provider: route.provider,
          model: route.model,
          system: system,
          messages: [{ id: 'pet-' + Date.now(), role: 'user', content: [{ type: 'text', text: userPrompt }], source: { kind: 'user' } }],
          maxTokens: 512,
          temperature: 0.9
        })
        for await (const chunk of stream) {
          if (!chunk) continue
          if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
          else if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text' && typeof chunk.block.text === 'string') text = chunk.block.text
          else if (chunk.type === 'finish') finish = chunk.reason
        }
        text = text.replace(/\s+/g, ' ').trim().slice(0, 160)
        if (!text) return { ok: false, text: '', diag: 'EMPTY ' + route.diag + ' finish=' + JSON.stringify(finish) }
        return { ok: true, text: text, diag: route.diag, affinity: affinity }
      } catch (err) {
        return { ok: false, text: '', diag: 'ERR ' + (err && err.message ? err.message : String(err)) }
      }
    })

    const disposeRoute = webServer.register({ kind: 'prefix', path: '/dsh-pet', handler })
    return () => { disposeRoute() }
  },
}
