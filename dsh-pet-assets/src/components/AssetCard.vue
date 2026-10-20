<script setup>
import { videoUrl, fmtBytes, catColor, catLabel } from '../api'
import { parseTags } from '../utils'

const props = defineProps({
  item: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
const emit = defineEmits(['edit', 'remove', 'copy', 'detail', 'toggle', 'select'])

function play(e) {
  const v = e.currentTarget.querySelector('video')
  if (v) v.play().catch(() => {})
}
function pause(e) {
  const v = e.currentTarget.querySelector('video')
  if (v) {
    v.pause()
    v.currentTime = 0
  }
}
</script>

<template>
  <li class="card" :class="{ off: !item.enabled }" :style="{ '--card-c': catColor(item.category) }">
    <div
      class="card-media"
      title="点击查看详情"
      @mouseenter="play"
      @mouseleave="pause"
      @click="emit('detail', item)"
    >
      <video :src="videoUrl(item.file)" muted loop playsinline preload="metadata"></video>
      <span class="cat-badge" :style="{ color: catColor(item.category) }">{{ catLabel(item.category) }}</span>
      <span class="card-check" :class="{ on: selected }" title="选择" @click.stop="emit('select', item)">✓</span>
    </div>
    <div class="card-body">
      <div class="card-title">
        <span class="name" :title="item.name">{{ item.name }}</span>
        <span v-if="!item.enabled" class="off-tag">已下线</span>
      </div>
      <div class="card-meta">
        <span class="size">{{ fmtBytes(item.size) }}</span>
        <span class="sha">#{{ item.sha256.slice(0, 8) }}</span>
        <span v-if="(item.weight ?? 100) !== 100" class="weight">×{{ item.weight }}</span>
      </div>
      <div class="card-tags">
        <span v-for="t in parseTags(item)" :key="t" class="tag">{{ t }}</span>
      </div>
      <div class="card-actions">
        <el-button text size="small" @click="emit('edit', item)">编辑</el-button>
        <el-button text size="small" @click="emit('copy', item)">复制链接</el-button>
        <el-button text size="small" :type="item.enabled ? 'warning' : 'success'" @click="emit('toggle', item)">
          {{ item.enabled ? '下线' : '上线' }}
        </el-button>
        <el-button text size="small" type="danger" @click="emit('remove', item)">删除</el-button>
      </div>
    </div>
  </li>
</template>
