<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'
import { shortPayload, statusText, statusType, errText } from '../utils'
import { useAssetsStore } from '../stores/assets'

const { items, commands, loadCommands } = useAssetsStore()

const cmdAnim = ref('')
const cmdText = ref('')
const notifyText = ref('')
const ttsText = ref('')

// 设备与批量下发
const devices = ref([])
const batchDevices = ref([])
const batchType = ref('notify')
const batchPayload = ref('{ "text": "" }')

// 定时任务
const schedules = ref([])
const schedCron = ref('0 10 * * *')
const schedType = ref('notify')
const schedPayload = ref('{ "text": "" }')
const schedDevice = ref('')
const schedEnabled = ref(true)

const CMD_OPTIONS = [
  { id: 'play', label: '播放动画' },
  { id: 'say', label: '说话' },
  { id: 'notify', label: '推消息' },
  { id: 'tts', label: '语音' },
  { id: 'sleep', label: '睡觉' },
  { id: 'wake', label: '唤醒' },
  { id: 'celebrate', label: '宅舞' },
  { id: 'stretch', label: '伸懒腰' },
  { id: 'focus', label: '专注' },
  { id: 'set_state', label: '设状态' },
  { id: 'config', label: '改配置' },
  { id: 'skin', label: '换肤' },
  { id: 'reboot', label: '重启' },
]

function parseJson(s) {
  if (!s || !s.trim()) return {}
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

async function sendCmd(type, payload = {}) {
  const { status, data } = await api.petCommand(type, payload)
  if (status !== 200) return ElMessage.error(errText(data.error) || '下发失败')
  ElMessage.success('已下发 ' + type)
  loadCommands()
}

async function sendSay() {
  if (!cmdText.value.trim()) return ElMessage.warning('输入要说的内容')
  await sendCmd('say', { text: cmdText.value.trim() })
  cmdText.value = ''
}

async function sendNotify() {
  if (!notifyText.value.trim()) return ElMessage.warning('输入要推送的消息')
  await sendCmd('notify', { text: notifyText.value.trim() })
  notifyText.value = ''
}

async function sendTts() {
  if (!ttsText.value.trim()) return ElMessage.warning('输入要朗读的内容')
  await sendCmd('tts', { text: ttsText.value.trim() })
  ttsText.value = ''
}

async function loadDevices() {
  const { status, data } = await api.pets()
  if (status === 200) devices.value = data.devices
}

async function loadSchedules() {
  const { status, data } = await api.schedules()
  if (status === 200) schedules.value = data.schedules
}

function deviceLabel(d) {
  return `${d.deviceId}${d.online ? ' · 在线' : ' · 离线'}${d.paired ? '' : ' · 未配对'}`
}

async function sendBatch() {
  const payload = parseJson(batchPayload.value)
  if (payload === null) return ElMessage.error('payload 不是合法 JSON')
  const { status, data } = await api.petCommand(
    batchType.value,
    payload,
    batchDevices.value.length ? batchDevices.value : undefined,
  )
  if (status !== 200) return ElMessage.error(errText(data.error) || '下发失败')
  ElMessage.success(`已下发 ${data.created.length} 条`)
  batchPayload.value = '{}'
  loadCommands()
}

async function createSched() {
  const payload = parseJson(schedPayload.value)
  if (payload === null) return ElMessage.error('payload 不是合法 JSON')
  const { status, data } = await api.createSchedule({
    cron: schedCron.value.trim(),
    type: schedType.value,
    payload,
    deviceId: schedDevice.value || undefined,
    enabled: schedEnabled.value,
  })
  if (status !== 200) return ElMessage.error(errText(data.error) || '创建失败')
  ElMessage.success('已创建定时任务')
  schedPayload.value = '{}'
  loadSchedules()
}

async function toggleSched(row) {
  const { status } = await api.updateSchedule(row.id, { enabled: !row.enabled })
  if (status === 200) loadSchedules()
  else ElMessage.error('操作失败')
}

async function removeSched(row) {
  try {
    await ElMessageBox.confirm(`删除定时任务「${row.cron} ${row.type}」？`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  const { status } = await api.deleteSchedule(row.id)
  if (status === 200) {
    ElMessage.success('已删除')
    loadSchedules()
  }
}

onMounted(() => {
  loadCommands()
  loadDevices()
  loadSchedules()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>桌宠控制台</h2>
      <span class="muted">远程指挥你的桌宠，命令 5 秒内送达</span>
    </div>

    <div class="panel console">
      <div class="console-row">
        <span class="console-label">动作</span>
        <el-button size="small" @click="sendCmd('sleep')">😴 睡觉</el-button>
        <el-button size="small" @click="sendCmd('wake')">🌞 唤醒</el-button>
        <el-button size="small" @click="sendCmd('celebrate')">💃 宅舞</el-button>
        <el-button size="small" @click="sendCmd('stretch')">🙆 伸懒腰</el-button>
        <el-button size="small" @click="sendCmd('focus')">🍅 专注</el-button>
        <el-button size="small" type="danger" plain @click="sendCmd('reboot')">♻️ 重启</el-button>
      </div>
      <div class="console-row">
        <span class="console-label">指定动画</span>
        <el-select v-model="cmdAnim" filterable class="cmd-select" placeholder="选一个动画">
          <el-option v-for="it in items" :key="it.id" :label="it.name" :value="it.name" />
        </el-select>
        <el-button size="small" type="primary" :disabled="!cmdAnim" @click="sendCmd('play', { anim: cmdAnim })">
          播放
        </el-button>
      </div>
      <div class="console-row">
        <span class="console-label">说话</span>
        <el-input v-model="cmdText" class="cmd-text" placeholder="让桌宠说一句话…" @keyup.enter="sendSay" />
        <el-button size="small" type="primary" @click="sendSay">发送</el-button>
      </div>
      <div class="console-row">
        <span class="console-label">推消息</span>
        <el-input v-model="notifyText" class="cmd-text" placeholder="推送一条提醒/消息…" @keyup.enter="sendNotify" />
        <el-button size="small" type="primary" @click="sendNotify">推送</el-button>
      </div>
      <div class="console-row">
        <span class="console-label">语音</span>
        <el-input v-model="ttsText" class="cmd-text" placeholder="让桌宠朗读…（TTS 未接时退化为气泡）" @keyup.enter="sendTts" />
        <el-button size="small" type="primary" @click="sendTts">朗读</el-button>
      </div>
    </div>

    <div class="panel console">
      <div class="console-head">
        <span>批量下发（选设备）</span>
        <span class="muted">不选设备 = 广播到所有已配对设备</span>
      </div>
      <div class="console-row">
        <span class="console-label">设备</span>
        <el-select v-model="batchDevices" multiple collapse-tags clearable class="batch-devices" placeholder="全部设备">
          <el-option v-for="d in devices" :key="d.deviceId" :label="deviceLabel(d)" :value="d.deviceId" />
        </el-select>
      </div>
      <div class="console-row">
        <span class="console-label">命令</span>
        <el-select v-model="batchType" class="cmd-select">
          <el-option v-for="c in CMD_OPTIONS" :key="c.id" :label="c.label" :value="c.id" />
        </el-select>
      </div>
      <div class="console-row">
        <span class="console-label">payload</span>
        <el-input v-model="batchPayload" class="cmd-text" placeholder='JSON，如 {"text":"喝水啦"}' />
      </div>
      <div class="console-row">
        <el-button size="small" type="primary" @click="sendBatch">下发到选中设备</el-button>
      </div>
    </div>

    <div class="panel console">
      <div class="console-head">
        <span>定时任务</span>
        <span class="muted">5 段 cron：分 时 日 月 周（如 0 10 * * * = 每天 10:00）</span>
      </div>
      <div class="console-row">
        <span class="console-label">cron</span>
        <el-input v-model="schedCron" class="cron-input" placeholder="0 10 * * *" />
        <span class="console-label">命令</span>
        <el-select v-model="schedType" class="cmd-select">
          <el-option v-for="c in CMD_OPTIONS" :key="c.id" :label="c.label" :value="c.id" />
        </el-select>
        <span class="console-label">设备</span>
        <el-select v-model="schedDevice" clearable class="cmd-select" placeholder="全部">
          <el-option v-for="d in devices" :key="d.deviceId" :label="d.deviceId" :value="d.deviceId" />
        </el-select>
      </div>
      <div class="console-row">
        <span class="console-label">payload</span>
        <el-input v-model="schedPayload" class="cmd-text" placeholder='JSON，如 {"text":"该喝水啦"}' />
        <el-button size="small" type="primary" @click="createSched">创建任务</el-button>
      </div>
      <el-table :data="schedules" size="small" height="280" class="cmd-table">
        <el-table-column prop="cron" label="cron" width="120" />
        <el-table-column prop="type" label="命令" width="90" />
        <el-table-column label="负载" min-width="130">
          <template #default="{ row }">{{ shortPayload(row) }}</template>
        </el-table-column>
        <el-table-column label="设备" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.deviceId || '全部' }}</template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.enabled" size="small" @change="toggleSched(row)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90" align="center">
          <template #default="{ row }">
            <el-button size="small" text type="danger" @click="removeSched(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel console">
      <div class="console-head">
        <span>最近命令</span>
        <el-button size="small" text @click="loadCommands">刷新</el-button>
      </div>
      <el-table :data="commands" size="small" height="360" class="cmd-table">
        <el-table-column prop="id" label="ID" width="60" />
        <el-table-column prop="type" label="类型" width="90" />
        <el-table-column label="负载" min-width="140">
          <template #default="{ row }">{{ shortPayload(row) }}</template>
        </el-table-column>
        <el-table-column label="设备" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.deviceId || '全部' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="96">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>
