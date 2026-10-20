<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, videoUrl } from '../api'
import { useAuth } from '../stores/auth'
import { useAssetsStore } from '../stores/assets'
import { useTheme } from '../stores/theme'

const route = useRoute()
const router = useRouter()
const auth = useAuth()

const {
  health,
  trashItems,
  pendingCount,
  loadResources,
  loadTrash,
  loadCommands,
  loadAudit,
  refreshHealth,
} = useAssetsStore()

const collapsed = ref(false)
const mascotFail = ref(false)
const { isDark, toggleTheme } = useTheme()
const mascotUrl = videoUrl('待机呼吸休闲.webm')

const MENUS = [
  { path: '/dashboard', icon: '🏠', title: '仪表盘' },
  { path: '/library', icon: '📚', title: '动作库' },
  { path: '/console', icon: '🎮', title: '桌宠控制台', badge: 'pending' },
  { path: '/pets', icon: '🐾', title: '宠物' },
  { path: '/trash', icon: '🗑️', title: '回收站', badge: 'trash' },
  { path: '/audit', icon: '📜', title: '审计日志' },
  { path: '/health', icon: '🩺', title: '健康检查' },
  { path: '/settings', icon: '⚙️', title: '设置' },
]

function badgeOf(m) {
  if (m.badge === 'pending') return pendingCount()
  if (m.badge === 'trash') return trashItems.length
  return 0
}

let timer = null
onMounted(() => {
  loadResources()
  loadTrash()
  loadCommands()
  loadAudit()
  refreshHealth()
  timer = setInterval(refreshHealth, 10000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})

async function doLogout() {
  await api.logout()
  auth.clearAuth()
  router.replace('/login')
}
</script>

<template>
  <div class="admin">
    <el-container class="shell">
      <el-aside :width="collapsed ? '68px' : '208px'" class="sidebar">
        <div class="side-logo">
          <span class="side-emoji">🐱</span>
          <span v-if="!collapsed" class="side-brand">动作图鉴</span>
        </div>
        <el-menu
          class="side-menu"
          :collapse="collapsed"
          :collapse-transition="false"
          :default-active="route.path"
          router
        >
          <el-menu-item v-for="m in MENUS" :key="m.path" :index="m.path">
            <span class="mi">
              {{ m.icon }}
              <span v-if="badgeOf(m)" class="side-badge">{{ badgeOf(m) > 99 ? '99+' : badgeOf(m) }}</span>
            </span>
            <template #title>
              <span class="side-title">{{ m.title }}</span>
            </template>
          </el-menu-item>
        </el-menu>
        <button
          class="collapse-btn"
          :title="collapsed ? '展开菜单' : '折叠菜单'"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? '»' : '« 折叠' }}
        </button>
      </el-aside>

      <el-container class="right">
        <el-header class="topbar" height="64px">
          <div class="mascot">
            <video :src="mascotUrl" autoplay muted loop playsinline @error="mascotFail = true"></video>
            <span v-if="mascotFail" class="fallback">🐱</span>
          </div>
          <div class="brand">
            <h1>dsh-pet 动作图鉴 <span class="tick">LIVE</span></h1>
            <p>哼，又在整理<em>我的动作库</em>？</p>
          </div>
          <div class="topbar-right">
            <span class="status-pill" :class="{ off: !health.online }">
              <span class="pulse-dot" :class="{ off: !health.online }"></span>
              <span>{{ health.online ? `在线 · ${health.assetCount} 动作` : '离线' }}</span>
            </span>
            <button class="theme-toggle" :title="isDark ? '切换到亮色主题' : '切换到暗色主题'" @click="toggleTheme">
              {{ isDark ? '☀️' : '🌙' }}
            </button>
            <el-button text @click="doLogout">退出</el-button>
          </div>
        </el-header>

        <el-main class="content">
          <router-view v-slot="{ Component }">
            <transition name="fade" mode="out-in">
              <keep-alive include="Library">
                <component :is="Component" />
              </keep-alive>
            </transition>
          </router-view>
        </el-main>
      </el-container>
    </el-container>
  </div>
</template>
