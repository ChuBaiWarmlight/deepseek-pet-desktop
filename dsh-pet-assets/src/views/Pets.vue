<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '../api'
import { fmtTime } from '../utils'

const devices = ref([])
const loading = ref(false)
const tokenDialog = ref(false)
const tokenText = ref('')
const tokenDevice = ref('')

const MOOD_LABEL = {
  normal: '正常',
  happy: '开心',
  shy: '害羞',
  curious: '好奇',
  bored: '无聊',
  tired: '困倦',
  sad: '低落',
  angry: '生气',
}

function moodText(value) {
  return MOOD_LABEL[value] || value || '—'
}

async function loadPets() {
  loading.value = true
  try {
    const { status, data } = await api.pets()
    devices.value = status === 200 ? data.devices : []
  } catch {
    devices.value = []
  } finally {
    loading.value = false
  }
}

function todayText(today) {
  if (!today || typeof today !== 'object') return '—'
  const parts = []
  if (today.chat) parts.push(`聊 ${today.chat}`)
  if (today.poke) parts.push(`戳 ${today.poke}`)
  if (today.feed) parts.push(`喂 ${today.feed}`)
  if (today.eat) parts.push(`吃 ${today.eat}`)
  if (today.focusMin) parts.push(`专注 ${today.focusMin}m`)
  if (today.taskDone) parts.push(`任务 ${today.taskDone}`)
  return parts.length ? parts.join(' · ') : '—'
}

async function doPair(row) {
  try {
    await ElMessageBox.confirm(
      `为设备 ${row.deviceId} 生成配对令牌？令牌仅本次展示一次，请复制后填入桌宠设置。`,
      '配对确认',
      { type: 'warning', confirmButtonText: '生成', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  const { status, data } = await api.pairPet(row.deviceId)
  if (status !== 200) return ElMessage.error(data.error || '配对失败')
  tokenDevice.value = row.deviceId
  tokenText.value = data.token
  tokenDialog.value = true
  await loadPets()
}

async function doUnpair(row) {
  try {
    await ElMessageBox.confirm(
      `取消配对 ${row.deviceId}？之后该设备将无法拉取/回执遥控命令。`,
      '取消配对',
      { type: 'warning', confirmButtonText: '取消配对', cancelButtonText: '保留' },
    )
  } catch {
    return
  }
  const { status, data } = await api.unpairPet(row.deviceId)
  if (status !== 200) return ElMessage.error(data.error || '操作失败')
  ElMessage.success('已取消配对')
  await loadPets()
}

function copyToken() {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(tokenText.value).then(
      () => ElMessage.success('已复制到剪贴板'),
      () => ElMessage.warning('复制失败，请手动选择复制'),
    )
  }
}

let timer = null
onMounted(() => {
  loadPets()
  timer = setInterval(loadPets, 10_000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>宠物设备</h2>
      <span class="muted">已配对桌宠的心跳遥测（每 30 秒上报，90 秒无心跳判为离线）</span>
    </div>

    <div class="panel">
      <div class="panel-head">
        <span>共 {{ devices.length }} 台设备</span>
        <el-button size="small" text @click="loadPets" :loading="loading">刷新</el-button>
      </div>
      <el-table :data="devices" size="small" height="440" v-loading="loading">
        <el-table-column label="状态" width="76">
          <template #default="{ row }">
            <el-tag :type="row.online ? 'success' : 'info'" size="small" effect="dark">
              {{ row.online ? '在线' : '离线' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="配对" width="82">
          <template #default="{ row }">
            <el-tag :type="row.paired ? 'success' : 'danger'" size="small">
              {{ row.paired ? '已配对' : '未配对' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="deviceId" label="设备 ID" min-width="170" show-overflow-tooltip />
        <el-table-column prop="version" label="版本" width="80" />
        <el-table-column label="亲密度" width="80" align="center">
          <template #default="{ row }">{{ row.affinity }}</template>
        </el-table-column>
        <el-table-column label="毒舌" width="70" align="center">
          <template #default="{ row }">{{ row.sass }}</template>
        </el-table-column>
        <el-table-column label="性格" width="70" align="center">
          <template #default="{ row }">{{ row.personality }}</template>
        </el-table-column>
        <el-table-column label="情绪" width="80">
          <template #default="{ row }">{{ moodText(row.mood) }}</template>
        </el-table-column>
        <el-table-column label="DSH" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="row.dshOnline ? 'success' : 'warning'" size="small">{{ row.dshOnline ? '通' : '断' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="今日" min-width="120">
          <template #default="{ row }">{{ todayText(row.today) }}</template>
        </el-table-column>
        <el-table-column label="最后心跳" width="150">
          <template #default="{ row }">{{ fmtTime(row.lastSeen) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button v-if="!row.paired" size="small" type="primary" @click="doPair(row)">配对</el-button>
            <el-button v-else size="small" @click="doUnpair(row)">取消配对</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="tokenDialog" title="配对令牌（仅显示一次）" width="480px" :close-on-click-modal="false">
      <p class="pair-hint">
        设备 <code>{{ tokenDevice }}</code> 的配对令牌如下，请复制后填入桌宠「设备配对」设置并保存。
        令牌不会再次显示，如丢失请重新配对。
      </p>
      <div class="pair-token" @click="copyToken" title="点击复制">{{ tokenText }}</div>
      <template #footer>
        <el-button size="small" @click="copyToken">复制</el-button>
        <el-button size="small" type="primary" @click="tokenDialog = false">我已保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.pair-hint {
  margin: 0 0 12px;
  line-height: 1.6;
  color: var(--el-text-color-regular);
}
.pair-hint code {
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--el-fill-color-light);
  font-family: monospace;
}
.pair-token {
  padding: 10px 12px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  background: var(--el-fill-color-lighter);
  font-family: monospace;
  font-size: 13px;
  word-break: break-all;
  cursor: pointer;
  user-select: all;
}
</style>
