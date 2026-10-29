<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useUserStore } from '@/store/user'
import { useAppStore } from '@/store/app'

const router = useRouter()
const userStore = useUserStore()
const appStore = useAppStore()
const formRef = ref<FormInstance | null>(null)
const loading = ref<boolean>(false)
const form = reactive({ userNo: '', password: '' })

const rules: FormRules<typeof form> = {
  userNo: [{ required: true, message: '请输入工号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
}

async function handleLogin(): Promise<void> {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await userStore.login({ userNo: form.userNo, password: form.password })
    ElMessage.success('登录成功')
    // 首次登录强制改密（契约 4.1）
    router.push(userStore.mustChangePassword ? '/change-password' : '/dashboard')
  } catch (err) {
    // 响应拦截器已统一弹错，这里兜底避免白屏
    const message = err instanceof Error ? err.message : '登录失败，请稍后重试'
    ElMessage.error(message)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100">
    <el-card class="w-[92vw] max-w-[380px]">
      <template #header>
        <div class="text-center text-lg font-bold">{{ appStore.systemName }}</div>
      </template>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="60px" @keyup.enter="handleLogin">
        <el-form-item label="工号" prop="userNo">
          <el-input v-model="form.userNo" placeholder="请输入工号" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password />
        </el-form-item>
        <el-form-item>
          <el-button class="w-full" type="primary" :loading="loading" @click="handleLogin">
            登 录
          </el-button>
        </el-form-item>
      </el-form>
    </el-card>
  </div>
</template>
