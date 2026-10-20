<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'

const router = useRouter()
const ready = ref(false)

// 等初始导航（含鉴权守卫）解析完成后再渲染，避免闪登录页/空白。
router.isReady().then(() => {
  ready.value = true
})
</script>

<template>
  <div v-if="!ready" class="app-boot">
    <span class="boot-dot"></span>
    <span>加载中…</span>
  </div>
  <router-view v-else />
</template>
