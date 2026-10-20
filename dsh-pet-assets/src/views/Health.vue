<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'

const healthResult = ref(null)

async function doHealthCheck() {
  healthResult.value = null
  const { status, data } = await api.healthCheck()
  if (status === 200) healthResult.value = data
}

onMounted(doHealthCheck)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>健康检查</h2>
      <el-button size="small" text @click="doHealthCheck">重新检查</el-button>
    </div>

    <div class="panel">
      <div v-if="!healthResult" class="muted" style="padding: 24px 0">检查中…</div>
      <template v-else>
        <el-result
          v-if="healthResult.ok"
          icon="success"
          title="一切正常"
          :sub-title="`${healthResult.total} 个上线动作均无缺失、无损坏`"
        />
        <div v-else>
          <el-alert
            type="error"
            :title="`发现 ${healthResult.issues.length} 个问题`"
            :closable="false"
            style="margin-bottom: 12px"
          />
          <el-table :data="healthResult.issues" size="small" class="cmd-table">
            <el-table-column prop="file" label="文件" min-width="180" />
            <el-table-column prop="problem" label="问题" width="160" />
          </el-table>
        </div>
      </template>
    </div>
  </div>
</template>
