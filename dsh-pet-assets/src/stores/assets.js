// 资源/健康/回收站/审计/命令共享状态（composable 单例）。
// 跨布局（顶栏、侧栏徽标）与各视图共享，保证数据一致。
import { ref, computed } from 'vue'
import { api } from '../api'

const items = ref([])
const stats = ref({ count: 0, totalBytes: 0, byCategory: {} })
const health = ref({ online: false, assetCount: 0 })
const trashItems = ref([])
const auditLogs = ref([])
const auditTotal = ref(0)
const commands = ref([])

// 分类计数：由 items 按 category 聚合，供仪表盘分类条与动作库分类 chips 共用。
const catCounts = computed(() => {
  const m = {}
  for (const i of items.value) m[i.category] = (m[i.category] || 0) + 1
  return m
})

async function loadResources() {
  const { status, data } = await api.resources()
  if (status === 200) {
    items.value = data.items
    stats.value = data.stats
    return true
  }
  return false
}

async function refreshHealth() {
  const { status, data } = await api.health()
  health.value = status === 200 ? { online: true, assetCount: data.assetCount } : { online: false, assetCount: 0 }
}

async function loadTrash() {
  const { status, data } = await api.trashList()
  if (status === 200) trashItems.value = data.items
}

async function loadAudit(params = {}) {
  const { status, data } = await api.auditLogs(params)
  if (status === 200) {
    auditLogs.value = data.logs
    auditTotal.value = data.total
    return true
  }
  return false
}

async function loadCommands() {
  const { status, data } = await api.petCommands()
  if (status === 200) commands.value = data.commands
}

function pendingCount() {
  return commands.value.filter((c) => c.status !== 'done').length
}

export function useAssetsStore() {
  return {
    items,
    stats,
    health,
    trashItems,
    auditLogs,
    auditTotal,
    commands,
    catCounts,
    loadResources,
    refreshHealth,
    loadTrash,
    loadAudit,
    loadCommands,
    pendingCount,
  }
}
