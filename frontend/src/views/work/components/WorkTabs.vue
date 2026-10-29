<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const hasSubordinates = computed<boolean>(() => (userStore.userInfo?.role ?? 1) >= 2)
const activeTab = ref<'mine' | 'subordinates'>(
  route.path === '/work/subordinates' ? 'subordinates' : 'mine'
)

function onTabChange(v: string): void {
  router.push(v === 'subordinates' ? '/work/subordinates' : '/work')
}
</script>

<template>
  <el-radio-group v-model="activeTab" @change="onTabChange">
    <el-radio-button value="mine">我的工作</el-radio-button>
    <el-radio-button v-if="hasSubordinates" value="subordinates">下级工作</el-radio-button>
  </el-radio-group>
</template>
