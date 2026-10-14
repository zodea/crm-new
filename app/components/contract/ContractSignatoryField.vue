<script setup lang="ts">
import type { ProjectContractFormDraft } from '~/lib/contract/forms'
import type { LookupOption } from '~/lib/kit/lookup'
import type { OurSignatoryRecord } from '~/lib/our-signatory/contract'
import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { signatorySnapshot } from '~/lib/our-signatory/contract'
import { createOurSignatoryRepository } from '~/lib/our-signatory/http-repository'
import { isDesktopRuntime } from '~/lib/platform/runtime'
import { bindReadAuthority } from '~/lib/read-model/authority'

const props = defineProps<{
  draft: ProjectContractFormDraft
  label: string
  error?: string
  supplement?: boolean
}>()
const emit = defineEmits<{
  patch: [
        value: Partial<ProjectContractFormDraft>,
  ]
}>()
const rows = shallowRef<OurSignatoryRecord[]>([])
const message = shallowRef('')
const loading = ref(false)
let generation = 0
let active = true
const repository = createOurSignatoryRepository((url, options) => $fetch<unknown, string>(url, { ...options, retry: 0 }))
function invalidate() {
  generation++
  rows.value = []
  loading.value = false
  message.value = '当前主体目录需要重新读取'
}
bindReadAuthority(invalidate)
async function load() {
  const current = ++generation
  if (isDesktopRuntime()) {
    message.value = '此独立桌面路径尚未接入一致主体目录；保留历史原文，请使用已开放的中央入口核实。'
    return
  }
  loading.value = true
  message.value = ''
  try {
    const data = await repository.list()
    if (current === generation && active)
      rows.value = data.records.filter(row => row.draft.status === 'active')
  }
  catch (cause) {
    if (current === generation && active)
      message.value = cause instanceof Error ? cause.message : '主体目录暂不可用'
  }
  finally {
    if (current === generation && active)
      loading.value = false
  }
}
async function fetchSignatories(keyword: string): Promise<LookupOption[]> {
  const needle = keyword.trim().toLocaleLowerCase('zh-CN')
  const options = rows.value.map(row => ({ id: row.id, label: row.draft.name, hint: row.draft.taxNo ?? undefined }))
  const snapshot = props.draft.ourSignatorySnapshot
  if (snapshot && !options.some(row => row.id === snapshot.id))
    options.push({ id: snapshot.id, label: snapshot.name, hint: '合同原快照' })
  return options.filter(row => !needle || row.id === keyword || row.label.toLocaleLowerCase('zh-CN').includes(needle))
}
function select(value: string | null) {
  if (!active || loading.value || message.value || props.supplement)
    return
  if (value && props.draft.ourSignatorySnapshot?.id === value)
    return
  const row = rows.value.find(row => row.id === value)
  if (value && !row)
    return
  if (!row) {
    emit('patch', { ourSignatoryId: null, ourSignatoryVersion: null, ourSignatorySnapshot: null })
    return
  }
  emit('patch', { ourSignatoryId: row.id, ourSignatoryVersion: row.version, ourSignatorySnapshot: signatorySnapshot(row) })
}
onMounted(load)
onDeactivated(() => {
  active = false
  invalidate()
})
onBeforeUnmount(() => {
  active = false
  invalidate()
})
onActivated(() => {
  if (!active) {
    active = true
    void load()
  }
})
</script>

<template>
  <div class="field-block form-span-full">
    <label class="field-label" :for="`our-signatory-${label}`">{{ label }}{{ supplement ? '（继承原合同）' : isDesktopRuntime() ? '' : ' *' }}</label>
    <LookupSelect v-if="!supplement" :field="`our-signatory-${label}`" :model-value="draft.ourSignatoryId ?? null" :fetch="fetchSignatories" :disabled-reason="loading ? '正在读取主体目录' : message || undefined" :invalid="Boolean(error)" placeholder="搜索已核实的签约主体" data-testid="contract-our-signatory" @update:model-value="select" />
    <p v-if="draft.ourSignatorySnapshot" class="m-0 text-12px text-ink-soft" data-testid="contract-our-signatory-snapshot">
      文书采用：{{ draft.ourSignatorySnapshot.name }} · 核实版本 {{ draft.ourSignatorySnapshot.version }}<span v-if="draft.ourSignatorySnapshot.taxNo"> · 税号 {{ draft.ourSignatorySnapshot.taxNo }}</span>
    </p>
    <p v-else-if="supplement" class="m-0 text-12px text-warn">
      原合同尚未记录主体快照，请先核实原合同。
    </p>
    <p v-if="draft.legacyPartyA" class="m-0 text-12px text-ink-soft">
      历史原文：{{ draft.legacyPartyA }}；尚未自动映射到主体。
    </p>
    <span v-if="error" class="field-error">{{ error }}</span>
    <p v-if="message" class="m-0 text-12px text-warn" role="status">
      {{ message }} <button v-if="!supplement" type="button" class="text-brand" @click="load">
        重新读取
      </button>
    </p>
    <NuxtLink v-if="!supplement && !isDesktopRuntime()" to="/settings/our-signatories" class="text-12px text-brand">
      维护我方签约主体
    </NuxtLink>
  </div>
</template>
