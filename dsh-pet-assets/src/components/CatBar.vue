<script setup>
const props = defineProps({
  category: { type: Object, required: true },
  count: { type: Number, default: 0 },
  total: { type: Number, default: 0 },
})

function widthPct() {
  if (!props.count || !props.total) return '0%'
  return Math.max(4, Math.round((props.count / props.total) * 100)) + '%'
}
</script>

<template>
  <div class="cat-bar">
    <span class="cat-bar-label" :style="{ color: category.color }">{{ category.label }}</span>
    <div class="cat-bar-track">
      <div class="cat-bar-fill" :style="{ width: widthPct(), background: category.color }"></div>
    </div>
    <span class="cat-bar-n">{{ count }}</span>
  </div>
</template>
