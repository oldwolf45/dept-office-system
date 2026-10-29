<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-gray-100">
    <h1 class="text-4xl font-bold text-gray-400 mb-4">403</h1>
    <p class="text-gray-500 mb-6">您没有权限访问该页面</p>
    <el-button type="primary" @click="router.push('/dashboard')">返回工作台</el-button>
  </div>
</template>
