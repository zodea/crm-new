<script setup lang="ts">
import { shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'

interface LifecycleRecord {
  id: string
  name: string
  version: string
  deletedAt: string | null
}

interface LifecycleActions {
  recover: (id: string) => Promise<{ current: LifecycleRecord, applied: boolean } | null>
  lifecycle: (id: string) => Promise<LifecycleRecord>
  change: (source: LifecycleRecord) => Promise<{ current: LifecycleRecord, recovered: boolean }>
}

const props = defineProps<{ entityId: string, entityLabel: string, actions: LifecycleActions }>()
const emit = defineEmits<{ state: [deleted: boolean | null], changed: [] }>()
const { confirm, success } = useKitUI()
const current = shallowRef<LifecycleRecord | null>(null)
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
    const recovered = await props.actions.recover(props.entityId)
    const value = recovered?.current ?? await props.actions.lifecycle(props.entityId)
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
  const label = `${restoring ? '恢复' : '删除'}${props.entityLabel}`
  const confirmed = await confirm({
    title: label,
    message: restoring ? `恢复“${source.name}”及其原有附件可见性？` : `将“${source.name}”移出${props.entityLabel}列表。原件保留，之后可以恢复。`,
    confirmLabel: label,
  })
  if (!confirmed)
    return
  busy.value = true
  problem.value = ''
  try {
    const result = await props.actions.change(source)
    if (result.current.id !== props.entityId)
      return
    current.value = result.current
    emit('state', !!result.current.deletedAt)
    emit('changed')
    success(result.recovered ? '已核对上次操作，请确认当前状态后继续。' : restoring ? `${props.entityLabel}已恢复` : `${props.entityLabel}已删除，可从已删除${props.entityLabel}恢复`)
  }
  catch (cause) { problem.value = `${toErrorMessage(cause)} 请先核对原操作，再继续。` }
  finally { busy.value = false }
}

watch(() => props.entityId, () => void load(), { immediate: true })
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" :aria-label="`${entityLabel}保存与恢复`">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-13px font-700">
          {{ entityLabel }}保存与恢复
        </h2><p class="mt-1 text-12px text-ink-muted">
          {{ current?.deletedAt ? `${entityLabel}已删除；恢复后可继续编辑和下载原件。` : `原件与${entityLabel}保存在同一工作区。删除后仍可恢复。` }}
        </p>
      </div>
      <button type="button" class="btn-secondary" :disabled="busy || !current" @click="change">
        {{ current?.deletedAt ? '恢复' : '删除' }}{{ entityLabel }}
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
