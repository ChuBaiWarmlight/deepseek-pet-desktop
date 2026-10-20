<script setup>
import { onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, catLabel, fmtBytes } from '../api'
import { fmtTime, errText } from '../utils'
import { useAssetsStore } from '../stores/assets'

const { trashItems, loadTrash, loadResources } = useAssetsStore()

onMounted(() => {
  loadTrash()
})

async function doRestore(it) {
  const { status, data } = await api.restoreTrash(it.file)
  if (status !== 200) return ElMessage.error(errText(data.error) || '恢复失败')
  ElMessage.success('已恢复 ' + it.name)
  loadTrash()
  loadResources()
}

async function doPurge(it) {
  try {
    await ElMessageBox.confirm(`彻底删除「${it.name}」？此操作不可撤销。`, '确认', { type: 'warning' })
  } catch {
    return
  }
  const { status, data } = await api.purgeTrash(it.file)
  if (status !== 200) return ElMessage.error(errText(data.error) || '删除失败')
  ElMessage.success('已彻底删除 ' + it.name)
  loadTrash()
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>回收站</h2>
      <span class="muted">删除的动作先到这里，可恢复或彻底删除</span>
    </div>

    <div class="panel">
      <el-table v-if="trashItems.length" :data="trashItems" size="small" class="cmd-table">
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="分类" width="100">
          <template #default="{ row }">{{ catLabel(row.category) }}</template>
        </el-table-column>
        <el-table-column label="大小" width="100">
          <template #default="{ row }">{{ fmtBytes(row.size) }}</template>
        </el-table-column>
        <el-table-column label="删除时间" width="180">
          <template #default="{ row }">{{ fmtTime(row.updated_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170">
          <template #default="{ row }">
            <el-button text size="small" type="primary" @click="doRestore(row)">恢复</el-button>
            <el-button text size="small" type="danger" @click="doPurge(row)">彻底删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="回收站是空的" />
    </div>
  </div>
</template>
