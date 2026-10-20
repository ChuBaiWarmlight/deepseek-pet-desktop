<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import { errText } from '../utils'
import { useAuth } from '../stores/auth'

const router = useRouter()
const auth = useAuth()

const oldPwd = ref('')
const newPwd = ref('')
const confirmPwd = ref('')

async function doChangePwd() {
  if (!oldPwd.value || !newPwd.value) return ElMessage.warning('请填写完整')
  if (newPwd.value.length < 8) return ElMessage.warning('新密码至少 8 位')
  if (newPwd.value !== confirmPwd.value) return ElMessage.warning('两次密码不一致')
  const { status, data } = await api.changePassword(oldPwd.value, newPwd.value)
  if (status !== 200) return ElMessage.error(errText(data.error) || '改密失败')
  ElMessage.success('密码已修改，请重新登录')
  auth.clearAuth()
  router.replace('/login')
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>设置</h2>
      <span class="muted">账号与安全</span>
    </div>

    <el-form label-position="top" class="pwd-form">
      <el-form-item label="当前密码">
        <el-input v-model="oldPwd" type="password" show-password />
      </el-form-item>
      <el-form-item label="新密码（≥8 位）">
        <el-input v-model="newPwd" type="password" show-password />
      </el-form-item>
      <el-form-item label="确认新密码">
        <el-input v-model="confirmPwd" type="password" show-password @keyup.enter="doChangePwd" />
      </el-form-item>
      <el-button type="primary" @click="doChangePwd">修改密码</el-button>
    </el-form>
  </div>
</template>
