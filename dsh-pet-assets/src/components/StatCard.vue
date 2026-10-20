<script setup>
defineProps({
  icon: { type: String, default: '' },
  value: { type: [String, Number], default: 0 },
  label: { type: String, default: '' },
})
</script>

<template>
  <div class="dash-card">
    <span class="dash-ico">{{ icon }}</span>
    <div class="dash-num">{{ value }}</div>
    <div class="dash-label">{{ label }}</div>
  </div>
</template>
