<script setup>
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, videoUrl, CATEGORIES, fmtBytes, catLabel } from '../api'
import { parseTags, errText, fmtTime } from '../utils'
import { useAssetsStore } from '../stores/assets'
import AssetCard from '../components/AssetCard.vue'

defineOptions({ name: 'Library' })

const { items, stats, catCounts, loadResources, loadTrash } = useAssetsStore()

const loading = ref(false)
const search = ref('')
const catFilter = ref('')
const sortBy = ref('name')
const uploadCat = ref('act')

// 编辑 dialog（保持为弹窗，不占路由）
const editVisible = ref(false)
const editTarget = ref(null)
const editName = ref('')
const editCategory = ref('act')
const editTags = ref([])
const editEnabled = ref(true)
const editWeight = ref(100)

// 详情预览 dialog
const detailVisible = ref(false)
const detail = ref(null)

// 批量选择 + 拖拽上传
const selected = ref(new Set())
const uploadingCount = ref(0)
const batchCategoryVisible = ref(false)
const batchCategory = ref('')
const batchTagsVisible = ref(false)
const batchTags = ref([])

// 调度器识别的语义标签预设；仍允许手动输入任意 key:value。
const TAG_PRESETS = [
  'scene:work', 'scene:rest', 'scene:meal', 'scene:night',
  'time:morning', 'time:day', 'time:evening', 'time:night', 'time:weekend',
  'mood:happy', 'mood:calm', 'mood:sad', 'mood:bored',
  'mood:angry', 'mood:shy', 'mood:tired', 'mood:curious',
  'cooldown:120', 'cooldown:300',
]

const tagOptions = computed(() => {
  const all = new Set(TAG_PRESETS)
  for (const it of items.value) for (const t of parseTags(it)) if (!t.startsWith('src:')) all.add(t)
  for (const t of editTags.value) if (!t.startsWith('src:')) all.add(t)
  for (const t of batchTags.value) if (!t.startsWith('src:')) all.add(t)
  return [...all]
})

const filtered = computed(() => {
  let list = items.value.slice()
  if (catFilter.value) list = list.filter((i) => i.category === catFilter.value)
  const q = search.value.trim().toLowerCase()
  if (q) list = list.filter((i) => (i.name + i.file).toLowerCase().includes(q))
  if (sortBy.value === 'size') list.sort((a, b) => b.size - a.size)
  else if (sortBy.value === 'new') list.sort((a, b) => b.created_at - a.created_at)
  else list.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return list
})

async function refresh() {
  loading.value = true
  await loadResources()
  loading.value = false
}

function openEdit(it) {
  editTarget.value = it
  editName.value = it.name
  editCategory.value = it.category
  editTags.value = parseTags(it)
  editEnabled.value = !!it.enabled
  editWeight.value = it.weight ?? 100
  editVisible.value = true
}

async function saveEdit() {
  if (!editName.value.trim()) return ElMessage.warning('动作名不能为空')
  const body = {
    name: editName.value.trim(),
    category: editCategory.value,
    tags: editTags.value,
    enabled: editEnabled.value,
    weight: editWeight.value,
  }
  const { status, data } = await api.patch(editTarget.value.file, body)
  if (status !== 200) return ElMessage.error(errText(data.error) || '保存失败')
  ElMessage.success('已保存')
  editVisible.value = false
  refresh()
}

async function remove(it) {
  try {
    await ElMessageBox.confirm(`确认删除「${it.name}」？文件将移入回收目录。`, '删除动作', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  const { status, data } = await api.remove(it.file)
  if (status !== 200) return ElMessage.error(errText(data.error) || '删除失败')
  ElMessage.success('已删除')
  refresh()
}

async function toggleEnable(it) {
  const { status, data } = await api.patch(it.file, { enabled: !it.enabled })
  if (status !== 200) return ElMessage.error(errText(data.error) || '操作失败')
  ElMessage.success(it.enabled ? '已下线' : '已上线')
  await refresh()
  if (detail.value && detail.value.file === it.file) {
    const fresh = items.value.find((x) => x.file === it.file)
    if (fresh) detail.value = fresh
  }
}

function openDetail(it) {
  detail.value = it
  detailVisible.value = true
}

function toggleSelect(it) {
  const s = selected.value
  if (s.has(it.file)) s.delete(it.file)
  else s.add(it.file)
}

async function batchPatch(body) {
  let ok = 0
  for (const f of [...selected.value]) {
    const { status } = await api.patch(f, body)
    if (status === 200) ok++
  }
  return ok
}

async function applyBatchCategory() {
  const total = selected.value.size
  const ok = await batchPatch({ category: batchCategory.value })
  ElMessage.success(`已更新 ${ok} / ${total} 项`)
  batchCategoryVisible.value = false
  selected.value.clear()
  refresh()
}

async function applyBatchTags() {
  const files = [...selected.value]
  let ok = 0
  for (const f of files) {
    const it = items.value.find((x) => x.file === f)
    const merged = Array.from(new Set([...(parseTags(it) || []), ...batchTags.value]))
    const { status } = await api.patch(f, { tags: merged })
    if (status === 200) ok++
  }
  ElMessage.success(`已更新 ${ok} / ${files.length} 项`)
  batchTagsVisible.value = false
  selected.value.clear()
  refresh()
}

async function batchToggle(enabled) {
  const total = selected.value.size
  const ok = await batchPatch({ enabled })
  ElMessage.success(enabled ? `已上线 ${ok} / ${total} 项` : `已下线 ${ok} / ${total} 项`)
  selected.value.clear()
  refresh()
}

async function batchRemove() {
  const total = selected.value.size
  try {
    await ElMessageBox.confirm(`确认删除选中的 ${total} 项？将移入回收站。`, '批量删除', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  let ok = 0
  for (const f of [...selected.value]) {
    const { status } = await api.remove(f)
    if (status === 200) ok++
  }
  ElMessage.success(`已删除 ${ok} / ${total} 项`)
  selected.value.clear()
  refresh()
  loadTrash()
}

async function copyUrl(it) {
  try {
    await navigator.clipboard.writeText(location.origin + videoUrl(it.file))
    ElMessage.success('链接已复制')
  } catch {
    ElMessage.error('复制失败')
  }
}

async function doUpload({ file }) {
  if (!file.name.endsWith('.webm')) {
    ElMessage.warning('仅支持 .webm：' + file.name)
    return
  }
  uploadingCount.value++
  const { status, data } = await api.upload(file, uploadCat.value)
  uploadingCount.value--
  if (status !== 200) return ElMessage.error(errText(data.error) || '上传失败')
  ElMessage.success('已收录「' + data.item.name + '」')
  refresh()
}

async function doRebuild() {
  const { status, data } = await api.rebuild()
  if (status !== 200) return ElMessage.error(errText(data.error) || '重建失败')
  ElMessage.success(`重建完成：新增 ${data.added}，更新 ${data.updated}，下线 ${data.removed}`)
  refresh()
}

onMounted(() => {
  if (!items.value.length) refresh()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>动作库</h2>
      <span class="muted">库内 <b>{{ items.length }}</b> 个动作 · 上线 <b>{{ stats.count }}</b> · <b>{{ fmtBytes(stats.totalBytes) }}</b></span>
    </div>

    <div class="toolbar">
      <el-input v-model="search" placeholder="搜动作名…" clearable class="search">
        <template #prefix>⌕</template>
      </el-input>
      <div class="chips">
        <button class="chip" :class="{ on: catFilter === '' }" @click="catFilter = ''">全部</button>
        <button
          v-for="c in CATEGORIES"
          :key="c.id"
          class="chip"
          :class="{ on: catFilter === c.id }"
          :style="{ '--chip-c': c.color }"
          @click="catFilter = catFilter === c.id ? '' : c.id"
        >
          {{ c.label }} <span class="n">{{ catCounts[c.id] || 0 }}</span>
        </button>
      </div>
      <el-select v-model="sortBy" class="w140">
        <el-option label="按名称" value="name" />
        <el-option label="按大小" value="size" />
        <el-option label="最新收录" value="new" />
      </el-select>
      <el-select v-model="uploadCat" class="w160">
        <el-option v-for="c in CATEGORIES" :key="c.id" :label="'分类 · ' + c.label" :value="c.id" />
      </el-select>
      <el-button text @click="doRebuild">重建清单</el-button>
    </div>

    <el-upload
      class="drop-zone"
      drag
      multiple
      :show-file-list="false"
      :http-request="doUpload"
      accept=".webm"
    >
      <span class="drop-ico">📥</span>
      <div class="drop-text">拖拽 .webm 动作文件到这里，或点击选择（支持多选，归入上方所选分类）</div>
      <div v-if="uploadingCount" class="muted">正在收录 {{ uploadingCount }} 个…</div>
    </el-upload>

    <div v-if="selected.size" class="batch-bar">
      <span class="muted">已选 <b>{{ selected.size }}</b> 项</span>
      <el-button size="small" @click="batchCategory = ''; batchCategoryVisible = true">改分类</el-button>
      <el-button size="small" @click="batchTags = []; batchTagsVisible = true">加标签</el-button>
      <el-button size="small" @click="batchToggle(true)">批量上线</el-button>
      <el-button size="small" @click="batchToggle(false)">批量下线</el-button>
      <el-button size="small" type="danger" @click="batchRemove">批量删除</el-button>
      <el-button size="small" text @click="selected.clear()">取消选择</el-button>
    </div>

    <ul v-if="!loading && filtered.length" class="grid">
      <AssetCard
        v-for="it in filtered"
        :key="it.id"
        :item="it"
        :selected="selected.has(it.file)"
        @edit="openEdit"
        @remove="remove"
        @copy="copyUrl"
        @detail="openDetail"
        @toggle="toggleEnable"
        @select="toggleSelect"
      />
    </ul>

    <el-empty v-else-if="!loading && !filtered.length" description="动作库空空如也，快给我塞点新动作" />
    <div v-else class="muted" style="padding: 24px 0">加载中…</div>

    <!-- 编辑动作 dialog（保留） -->
    <el-dialog v-model="editVisible" title="编辑动作" width="440" align-center>
      <el-form label-position="top">
        <el-form-item label="动作名">
          <el-input v-model="editName" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="editCategory" style="width: 100%">
            <el-option v-for="c in CATEGORIES" :key="c.id" :label="c.label" :value="c.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="标签">
          <el-select
            v-model="editTags"
            multiple
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            placeholder="输入后回车添加"
          >
            <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
          </el-select>
          <div style="margin-top: 6px; font-size: 12px; color: var(--el-text-color-secondary)">
            调度器识别 scene / time / mood / cooldown；没有语义标签的素材仍会正常播放。
          </div>
        </el-form-item>
        <el-form-item label="状态">
          <el-switch v-model="editEnabled" active-text="上线" inactive-text="下线" />
        </el-form-item>
        <el-form-item label="随机权重（0–1000，越大越常被随机选中）">
          <el-input-number v-model="editWeight" :min="0" :max="1000" :step="10" style="width: 100%" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <!-- 动作详情预览 dialog -->
    <el-dialog v-model="detailVisible" :title="detail?.name || '动作详情'" width="600" align-center>
      <template v-if="detail">
        <div class="detail-media">
          <video :src="videoUrl(detail.file)" controls autoplay loop playsinline></video>
        </div>
        <div class="detail-rows">
          <div class="detail-row"><span class="k">分类</span><span class="v">{{ catLabel(detail.category) }}</span></div>
          <div class="detail-row"><span class="k">状态</span><span class="v">{{ detail.enabled ? '上线中' : '已下线' }}</span></div>
          <div class="detail-row"><span class="k">大小</span><span class="v">{{ fmtBytes(detail.size) }}</span></div>
          <div class="detail-row"><span class="k">权重</span><span class="v">{{ detail.weight ?? 100 }}</span></div>
          <div class="detail-row"><span class="k">SHA256</span><span class="v mono">{{ detail.sha256 }}</span></div>
          <div class="detail-row"><span class="k">收录时间</span><span class="v">{{ fmtTime(detail.created_at) }}</span></div>
          <div class="detail-row"><span class="k">更新时间</span><span class="v">{{ fmtTime(detail.updated_at) }}</span></div>
          <div class="detail-row">
            <span class="k">标签</span>
            <span class="v">
              <span v-for="t in parseTags(detail)" :key="t" class="tag">{{ t }}</span>
              <span v-if="!parseTags(detail).length" class="muted">—</span>
            </span>
          </div>
        </div>
      </template>
      <template #footer>
        <template v-if="detail">
          <el-button @click="copyUrl(detail)">复制链接</el-button>
          <el-button @click="openEdit(detail); detailVisible = false">编辑</el-button>
          <el-button :type="detail.enabled ? 'warning' : 'success'" @click="toggleEnable(detail)">
            {{ detail.enabled ? '下线' : '上线' }}
          </el-button>
          <el-button type="danger" @click="detailVisible = false; remove(detail)">删除</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 批量改分类 -->
    <el-dialog v-model="batchCategoryVisible" title="批量改分类" width="360" align-center>
      <el-select v-model="batchCategory" style="width: 100%" placeholder="选择分类">
        <el-option v-for="c in CATEGORIES" :key="c.id" :label="c.label" :value="c.id" />
      </el-select>
      <template #footer>
        <el-button @click="batchCategoryVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!batchCategory" @click="applyBatchCategory">确定</el-button>
      </template>
    </el-dialog>

    <!-- 批量加标签 -->
    <el-dialog v-model="batchTagsVisible" title="批量加标签" width="420" align-center>
      <el-select
        v-model="batchTags"
        multiple
        filterable
        allow-create
        default-first-option
        style="width: 100%"
        placeholder="输入后回车添加标签"
      >
        <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
      </el-select>
      <template #footer>
        <el-button @click="batchTagsVisible = false">取消</el-button>
        <el-button type="primary" :disabled="!batchTags.length" @click="applyBatchTags">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
