<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, type FormInstance, type FormRules } from 'element-plus'
import { useAppStore } from '@/store/app'
import { postBootstrapAdmin } from '@/api/system'
import { BOOTSTRAP_PASSWORD_MIN, validateBootstrapInput } from '@/utils/bootstrap'

const router = useRouter()
const appStore = useAppStore()
const formRef = ref<FormInstance | null>(null)
const loading = ref<boolean>(false)
const form = reactive({ name: '', password: '', confirm: '' })

const validateConfirm = (_rule: unknown, value: string, callback: (e?: Error) => void): void => {
  if (!value) callback(new Error('请再次输入密码'))
  else if (value !== form.password) callback(new Error('两次输入的密码不一致'))
  else callback()
}

const rules: FormRules<typeof form> = {
  name: [
    { required: true, message: '请输入管理员姓名', trigger: 'blur' },
    { min: 2, max: 20, message: '姓名长度需为 2-20 字', trigger: 'blur' }
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    { min: BOOTSTRAP_PASSWORD_MIN, message: `密码至少 ${BOOTSTRAP_PASSWORD_MIN} 位`, trigger: 'blur' }
  ],
  confirm: [{ required: true, validator: validateConfirm, trigger: 'blur' }]
}

async function submit(): Promise<void> {
  if (!formRef.value) return
  // 前端先做一次纯函数校验（与单测同源）
  const errs = validateBootstrapInput(form)
  if (errs.length) {
    ElMessage.warning(errs[0])
    return
  }
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    await postBootstrapAdmin({ name: form.name.trim(), password: form.password })
    ElMessage.success('系统管理员创建成功，请登录')
    appStore.markBootstrapDone()
    router.push('/login')
  } catch {
    // 拦截器已提示（重复创建/发行模式未开启 4000 等）
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-100 p-3">
    <el-card class="w-[92vw] max-w-[420px]">
      <template #header>
        <div class="text-center text-lg font-bold">{{ appStore.systemName }}</div>
      </template>
      <el-alert type="info" :closable="false" title="首次启动：请创建系统管理员" class="mb-4" />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="姓名" prop="name">
          <el-input v-model="form.name" maxlength="20" placeholder="管理员姓名（2-20 字）" />
        </el-form-item>
        <el-form-item label="密码" prop="password">
          <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirm">
          <el-input v-model="form.confirm" type="password" show-password placeholder="再次输入密码" />
        </el-form-item>
        <el-button type="primary" class="w-full" :loading="loading" @click="submit">创建管理员并进入登录</el-button>
      </el-form>
    </el-card>
  </div>
</template>
