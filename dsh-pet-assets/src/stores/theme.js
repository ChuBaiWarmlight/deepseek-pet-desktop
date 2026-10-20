import { ref } from 'vue'

// 明暗主题：以 <html> 上的 .dark 类为准，偏好持久化到 localStorage。
const isDark = ref(document.documentElement.classList.contains('dark'))

function apply() {
  document.documentElement.classList.toggle('dark', isDark.value)
  try { localStorage.setItem('dsh.theme', isDark.value ? 'dark' : 'light') } catch (e) { /* ignore */ }
}

function toggleTheme() {
  isDark.value = !isDark.value
  apply()
}

export function useTheme() {
  return { isDark, toggleTheme }
}
