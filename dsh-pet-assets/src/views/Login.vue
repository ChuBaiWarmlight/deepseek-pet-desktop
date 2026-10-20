<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import { errText } from '../utils'
import { useAuth } from '../stores/auth'

const router = useRouter()
const auth = useAuth()

const username = ref('admin')
const password = ref('')
const loading = ref(false)
const mustChange = ref(false)
const oldPassword = ref('')
const newPassword = ref('')
const confirmPwd = ref('')

async function doLogin() {
  if (!username.value || !password.value) return ElMessage.warning('请输入用户名和密码')
  loading.value = true
  const { status, data } = await api.login(username.value, password.value)
  loading.value = false
  if (status !== 200) return ElMessage.error(errText(data.error) || '登录失败')
  if (data.mustChangePassword) {
    mustChange.value = true
    oldPassword.value = password.value
  } else {
    auth.setAuthed({ username: username.value })
    router.replace('/dashboard')
  }
}

async function doChange() {
  if (newPassword.value.length < 8) return ElMessage.warning('新密码至少 8 位')
  if (newPassword.value !== confirmPwd.value) return ElMessage.warning('两次密码不一致')
  const { status, data } = await api.changePassword(oldPassword.value, newPassword.value)
  if (status !== 200) return ElMessage.error(errText(data.error) || '改密失败')
  ElMessage.success('密码已修改，请用新密码登录')
  mustChange.value = false
  password.value = ''
  newPassword.value = ''
  confirmPwd.value = ''
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-mascot">🐱</div>
      <h1>dsh-pet 动作图鉴</h1>
      <p class="lead">傲娇猫桌宠的资源后台，先亮明身份</p>

      <el-form v-if="!mustChange" label-position="top" @submit.prevent="doLogin">
        <el-form-item label="用户名">
          <el-input v-model="username" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input
            v-model="password"
            type="password"
            show-password
            autocomplete="current-password"
            @keyup.enter="doLogin"
          />
        </el-form-item>
        <el-button class="login-submit" type="primary" :loading="loading" @click="doLogin">
          {{ loading ? '登录中…' : '进入后台' }}
        </el-button>
      </el-form>

      <el-form v-else label-position="top" @submit.prevent="doChange">
        <p class="lead">首次登录，先修改初始密码</p>
        <el-form-item label="当前密码">
          <el-input v-model="oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码（≥8 位）">
          <el-input v-model="newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="confirmPwd" type="password" show-password @keyup.enter="doChange" />
        </el-form-item>
        <el-button class="login-submit" type="primary" @click="doChange">保存密码</el-button>
      </el-form>
    </div>
  </div>
</template>
