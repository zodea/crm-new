<script setup lang="ts">
import type { CustomerLifecycleRead } from '~/lib/customer/production-contract'
import { onActivated, onMounted, shallowRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { useCustomerProductionStore } from '~/stores/customer-production'

const store = useCustomerProductionStore()
const rows = shallowRef<CustomerLifecycleRead[]>([])
const problem = shallowRef('')
const busy = shallowRef(false)
let generation = 0
async function load() {
  const token = ++generation
  busy.value = true
  problem.value = ''
  try {
    const current = await store.deleted()
    if (token === generation)
      rows.value = current
  }
  catch (cause) {
    if (token === generation)
      problem.value = toErrorMessage(cause)
  }
  finally {
    if (token === generation)
      busy.value = false
  }
}
onMounted(() => void load())
onActivated(() => void load())
</script>

<template>
  <details class="panel min-w-0 p-4" @toggle="($event.target as HTMLDetailsElement).open && load()">
    <summary class="cursor-pointer text-13px font-700">
      已删除客户（{{ rows.length }}）
    </summary>
    <p class="mt-2 text-12px text-ink-muted">
      打开客户详情可核对原档案并恢复。
    </p>
    <p v-if="problem" role="alert" class="mt-2 text-12px text-danger">
      {{ problem }}
    </p>
    <p v-else-if="!rows.length" class="mt-2 text-12px text-ink-muted">
      {{ busy ? '正在读取…' : '没有已删除客户' }}
    </p>
    <ul v-else class="mt-2 grid gap-2">
      <li v-for="row in rows" :key="row.id" class="min-w-0">
        <NuxtLink class="break-words text-12px text-brand" :to="`/base/customer/${encodeURIComponent(row.id)}?origin=real`">
          {{ row.name || '未命名草稿' }}
        </NuxtLink>
      </li>
    </ul>
  </details>
</template>
