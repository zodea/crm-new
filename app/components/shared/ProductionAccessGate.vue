<script setup lang="ts">
import { useIntervalFn } from '@vueuse/core'
import { computed, onMounted, shallowRef } from 'vue'
import { useProductionAccessStore } from '~/stores/production-access'

const store = useProductionAccessStore()
const accessCode = shallowRef('')
const checking = shallowRef(true)
const retainWorkspace = computed(() => store.status?.mode === 'development' || store.status?.authenticated === true)
async function check() {
  checking.value = true
  await store.check()
  checking.value = false
}
async function login() {
  if (await store.login(accessCode.value)) {
    accessCode.value = ''
    window.location.assign('/base/customer')
  }
  else {
    accessCode.value = ''
  }
}
onMounted(() => void check())
useIntervalFn(() => {
  if (store.status?.mode === 'production' && !store.busy)
    void store.check()
}, 60_000)
</script>

<template>
  <div v-if="retainWorkspace" v-show="store.allowed" class="contents" :inert="store.allowed ? undefined : true" :aria-hidden="!store.allowed || undefined">
    <slot />
  </div>
  <main v-if="!store.allowed" class="grid min-h-svh place-items-center bg-surface-2 p-4">
    <section class="panel w-full max-w-100 p-6" aria-labelledby="owner-access-title">
      <p class="mb-3 text-12px font-700 text-brand">
        瑞航 CRM · 本机工作区
      </p>
      <h1 id="owner-access-title" class="text-20px font-800">
        {{ checking ? '正在核对访问状态' : retainWorkspace ? '连接暂不可用' : '进入客户资料' }}
      </h1>
      <p v-if="retainWorkspace" class="mt-2 text-12px leading-6 text-ink-muted">
        客户输入和已选原件仍保留在当前页面，连接恢复后可继续。
      </p>
      <p class="mt-2 text-12px leading-6 text-ink-muted">
        {{ store.status?.mode === 'production' && store.status.purpose === 'verification' ? '当前是隔离验证工作区，请只使用验证资料。' : '请使用维护人设置的本机访问码。' }}
      </p>
      <form v-if="!checking && store.status?.mode === 'production' && !store.status.authenticated" class="mt-5 grid gap-3" @submit.prevent="login">
        <label class="grid gap-2 text-12px font-600">本机访问码<input v-model="accessCode" type="password" name="password" autocomplete="current-password" class="field-input w-full" required minlength="12" maxlength="256" :disabled="store.busy"></label>
        <button type="submit" class="btn-accent w-full" :disabled="store.busy">
          {{ store.busy ? '正在核对…' : '进入工作区' }}
        </button>
      </form>
      <p v-if="store.problem" role="alert" class="mt-4 break-words text-12px leading-6 text-danger">
        {{ store.problem }}
      </p>
      <button v-if="!checking && (!store.status || retainWorkspace)" type="button" class="btn-secondary mt-4" @click="check">
        重新核对
      </button>
      <p class="mt-5 text-11px leading-5 text-ink-faint">
        服务重启或登录过期后需要重新输入访问码。客户记录和已保存原件不受影响。
      </p>
    </section>
  </main>
</template>
