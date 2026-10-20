<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fmtTime, fmtDetail } from '../utils'
import { useAssetsStore } from '../stores/assets'

const { auditLogs, auditTotal, loadAudit } = useAssetsStore()

const ACTION_OPTIONS = [
  { value: '', label: '全部动作' },
  { value: 'login', label: '登录' },
  { value: 'login_failed', label: '登录失败' },
  { value: 'logout', label: '退出' },
  { value: 'change_password', label: '改密' },
  { value: 'upload', label: '上传' },
  { value: 'delete', label: '删除' },
  { value: 'patch', label: '编辑' },
  { value: 'rebuild', label: '重建' },
  { value: 'restore', label: '恢复' },
  { value: 'purge', label: '彻底删除' },
  { value: 'pet_cmd', label: '遥控命令' },
]
const TIME_OPTIONS = [
  { value: 0, label: '全部时间' },
  { value: 1, label: '最近 1 天' },
  { value: 7, label: '最近 7 天' },
  { value: 30, label: '最近 30 天' },
]

const action = ref('')
const days = ref(0)
const page = ref(1)
const pageSize = 20

async function fetchAudit() {
  const params = { limit: pageSize, offset: (page.value - 1) * pageSize, action: action.value }
  if (days.value > 0) params.from = Date.now() - days.value * 86400000
  const ok = await loadAudit(params)
  if (!ok) ElMessage.error('加载审计日志失败')
}

function onFilterChange() {
  page.value = 1
  fetchAudit()
}

onMounted(fetchAudit)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>审计日志</h2>
      <span class="muted">登录与所有写操作的记录</span>
    </div>

    <div class="toolbar">
      <el-select v-model="action" class="w160" @change="onFilterChange">
        <el-option v-for="a in ACTION_OPTIONS" :key="a.value" :label="a.label" :value="a.value" />
      </el-select>
      <el-select v-model="days" class="w140" @change="onFilterChange">
        <el-option v-for="t in TIME_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <span class="muted">共 {{ auditTotal }} 条</span>
    </div>

    <div class="panel">
      <el-table :data="auditLogs" size="small" class="cmd-table">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column prop="username" label="用户" width="90" />
        <el-table-column prop="action" label="动作" width="110" />
        <el-table-column prop="target" label="目标" min-width="160" />
        <el-table-column label="详情" min-width="150">
          <template #default="{ row }">{{ fmtDetail(row.detail) }}</template>
        </el-table-column>
      </el-table>
      <div class="pager">
        <el-pagination
          background
          layout="prev, pager, next, total"
          :total="auditTotal"
          :page-size="pageSize"
          :current-page="page"
          @current-change="(p) => { page = p; fetchAudit() }"
        />
      </div>
    </div>
  </div>
</template>
