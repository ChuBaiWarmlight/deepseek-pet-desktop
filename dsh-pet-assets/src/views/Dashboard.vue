<script setup>
import { onMounted } from 'vue'
import { CATEGORIES, fmtBytes } from '../api'
import { fmtTime } from '../utils'
import { useAssetsStore } from '../stores/assets'
import StatCard from '../components/StatCard.vue'
import CatBar from '../components/CatBar.vue'

const { stats, health, trashItems, auditLogs, catCounts, pendingCount, loadResources, loadAudit } =
  useAssetsStore()

onMounted(() => {
  loadResources()
  loadAudit()
})
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>仪表盘</h2>
      <span class="muted">资源池与桌宠状态的实时快照</span>
    </div>

    <div class="dash-grid">
      <StatCard icon="🎬" :value="stats.count" label="动作总数" />
      <StatCard icon="💾" :value="fmtBytes(stats.totalBytes)" label="占用空间" />
      <StatCard icon="🗑️" :value="trashItems.length" label="回收站" />
      <StatCard icon="📡" :value="pendingCount()" label="待执行命令" />
    </div>

    <div class="dash-row">
      <section class="dash-panel">
        <div class="panel-head">
          <h2>服务状态</h2>
          <span class="pulse-dot" :class="{ off: !health.online }"></span>
          <span class="muted">{{ health.online ? '平台在线' : '平台离线' }}</span>
        </div>
        <div class="cat-bars">
          <CatBar
            v-for="c in CATEGORIES"
            :key="c.id"
            :category="c"
            :count="catCounts[c.id] || 0"
            :total="stats.count"
          />
        </div>
      </section>

      <section class="dash-panel">
        <div class="panel-head"><h2>最近活动</h2></div>
        <ul class="recent">
          <li v-for="a in auditLogs.slice(0, 6)" :key="a.id" class="recent-item">
            <span class="recent-act">{{ a.action }}</span>
            <span class="recent-target" :title="a.target">{{ a.target || '—' }}</span>
            <span class="recent-time">{{ fmtTime(a.created_at) }}</span>
          </li>
          <li v-if="!auditLogs.length" class="muted" style="padding: 12px 0">暂无记录</li>
        </ul>
      </section>
    </div>
  </div>
</template>
