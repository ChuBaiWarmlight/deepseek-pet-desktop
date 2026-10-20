import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import App from './App.vue'
import router from './router'
import { setUnauthorizedHandler } from './api'
import { useAuth } from './stores/auth'
import './style.css'

const app = createApp(App)
app.use(ElementPlus)
app.use(router)

// 任意非 /api/auth/* 接口返回 401（会话失效）→ 清鉴权态并回登录页。
setUnauthorizedHandler(() => {
  useAuth().clearAuth()
  router.replace('/login')
})

app.mount('#app')
