import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from '../stores/auth'

const routes = [
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  {
    path: '/',
    component: () => import('../views/AdminLayout.vue'),
    children: [
      { path: '', redirect: '/dashboard' },
      { path: 'dashboard', name: 'dashboard', component: () => import('../views/Dashboard.vue') },
      { path: 'library', name: 'library', component: () => import('../views/Library.vue') },
      { path: 'console', name: 'console', component: () => import('../views/Console.vue') },
      { path: 'pets', name: 'pets', component: () => import('../views/Pets.vue') },
      { path: 'trash', name: 'trash', component: () => import('../views/Trash.vue') },
      { path: 'audit', name: 'audit', component: () => import('../views/Audit.vue') },
      { path: 'health', name: 'health', component: () => import('../views/Health.vue') },
      { path: 'settings', name: 'settings', component: () => import('../views/Settings.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 鉴权守卫：首次导航异步判定登录态并缓存；登录态变化经 setAuthed/clearAuth 即时更新。
router.beforeEach(async (to) => {
  const { checkAuth } = useAuth()
  const user = await checkAuth()
  if (to.path === '/login') {
    return user ? '/dashboard' : true
  }
  if (!user) return '/login'
  return true
})

export default router
