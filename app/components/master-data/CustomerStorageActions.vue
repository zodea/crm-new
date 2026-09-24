<script setup lang="ts">
import type { CustomerLifecycleRead } from '~/lib/customer/production-contract'
import { shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { useCustomerProductionStore } from '~/stores/customer-production'

const props = defineProps<{ customerId: string }>()
const emit = defineEmits<{ state: [deleted: boolean | null], changed: [] }>()
const store = useCustomerProductionStore()
const { confirm, success } = useKitUI()
const current = shallowRef<CustomerLifecycleRead | null>(null)
const busy = shallowRef(false)
const problem = shallowRef('')
const notice = shallowRef('')
let generation = 0
async function load() {
  const token = ++generation
  current.value = null
  emit('state', null)
  problem.value = ''
  busy.value = true
  try {
    const recovered = await store.recover(props.customerId)
    const value = recovered?.current ?? await store.lifecycle(props.customerId)
    if (token !== generation)
      return
    current.value = value
    emit('state', !!value.deletedAt)
    if (recovered)
      notice.value = recovered.applied ? '上次操作已保存，现已核对当前状态。' : '上次操作没有保存，迟到请求已封存。'
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
async function change() {
  const source = current.value
  if (!source || busy.value)
    return
  const restoring = !!source.deletedAt
  if (!await confirm({ title: restoring ? '恢复客户' : '删除客户', message: restoring ? `恢复“${source.name}”及其原有附件可见性？` : `将“${source.name}”移出客户列表。原件保留，之后可以恢复。`, confirmLabel: restoring ? '恢复客户' : '删除客户' }))
    return
  busy.value = true
  problem.value = ''
  try {
    const result = await store.change(source)
    if (result.current.id !== props.customerId)
      return
    current.value = result.current
    emit('state', !!result.current.deletedAt)
    emit('changed')
    success(result.recovered ? '已核对上次操作，请确认当前状态后继续。' : restoring ? '客户已恢复' : '客户已删除，可从已删除客户恢复')
  }
  catch (cause) { problem.value = `${toErrorMessage(cause)} 请先核对原操作，再继续。` }
  finally { busy.value = false }
}
watch(() => props.customerId, () => void load(), { immediate: true })
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="客户保存与恢复">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-13px font-700">
          客户保存与恢复
        </h2><p class="mt-1 text-12px text-ink-muted">
          {{ current?.deletedAt ? '客户已删除；恢复后可继续编辑和下载原件。' : '原件与客户保存在同一工作区。删除后仍可恢复。' }}
        </p>
      </div>
      <button type="button" class="btn-secondary" :disabled="busy || !current" @click="change">
        {{ current?.deletedAt ? '恢复客户' : '删除客户' }}
      </button>
    </div>
    <p v-if="notice" class="text-12px text-brand" role="status">
      {{ notice }}
    </p>
    <div v-if="problem" class="grid gap-2 text-12px text-danger" role="alert">
      <p>{{ problem }}</p><button type="button" class="btn-secondary justify-self-start" :disabled="busy" @click="load">
        核对原操作
      </button>
    </div>
  </section>
</template>
