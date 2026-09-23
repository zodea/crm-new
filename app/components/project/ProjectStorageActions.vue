<script setup lang="ts">
import type { ProjectLifecycleRead } from '~/lib/project/production-contract'
import { shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { useProjectProductionStore } from '~/stores/project-production'

const props = defineProps<{ projectId: string }>()
const emit = defineEmits<{ state: [deleted: boolean | null], changed: [] }>()
const store = useProjectProductionStore()
const { confirm, success } = useKitUI()
const current = shallowRef<ProjectLifecycleRead | null>(null)
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
    const recovered = await store.recover(props.projectId)
    const value = recovered?.current ?? await store.lifecycle(props.projectId)
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
  if (!await confirm({ title: restoring ? '恢复项目' : '删除项目', message: restoring ? `恢复“${source.name}”及其原有附件可见性？` : `将“${source.name}”移出项目列表。原件保留，之后可以恢复。`, confirmLabel: restoring ? '恢复项目' : '删除项目' }))
    return
  busy.value = true
  problem.value = ''
  try {
    const result = await store.change(source)
    if (result.current.id !== props.projectId)
      return
    current.value = result.current
    emit('state', !!result.current.deletedAt)
    emit('changed')
    success(result.recovered ? '已核对上次操作，请确认当前状态后继续。' : restoring ? '项目已恢复' : '项目已删除，可从已删除项目恢复')
  }
  catch (cause) { problem.value = `${toErrorMessage(cause)} 请先核对原操作，再继续。` }
  finally { busy.value = false }
}
watch(() => props.projectId, () => void load(), { immediate: true })
</script>

<template>
  <section class="panel grid min-w-0 gap-3 p-4" aria-label="项目保存与恢复">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-13px font-700">
          项目保存与恢复
        </h2><p class="mt-1 text-12px text-ink-muted">
          {{ current?.deletedAt ? '项目已删除；恢复后可继续编辑和下载原件。' : '原件与项目保存在同一工作区。删除后仍可恢复。' }}
        </p>
      </div>
      <button type="button" class="btn-secondary" :disabled="busy || !current" @click="change">
        {{ current?.deletedAt ? '恢复项目' : '删除项目' }}
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
