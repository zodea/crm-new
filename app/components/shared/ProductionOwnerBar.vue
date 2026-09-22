<script setup lang="ts">
import { useProductionAccessStore } from '~/stores/production-access'

const store = useProductionAccessStore()
async function logout() {
  if (await store.logout())
    window.location.reload()
}
</script>

<template>
  <div v-if="store.status?.mode === 'production' && store.status.authenticated" class="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-brand-soft px-4 py-2 text-11px" role="status">
    <span class="min-w-0 break-words">{{ store.status.purpose === 'verification' ? '隔离验证工作区 · 请勿录入正式资料' : '正式工作区 · 首次写入等待备份与上线验收' }} · 维护人：{{ store.status.ownerId }}</span>
    <button type="button" class="btn-ghost shrink-0" :disabled="store.busy" @click="logout">
      退出本机登录
    </button>
  </div>
</template>
