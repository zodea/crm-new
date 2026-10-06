<script setup lang="ts">
import type { ProjectContractFormDraft } from '~/lib/contract/forms'
import type { OurSignatoryRecord } from '~/lib/our-signatory/contract'
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
const repository = createOurSignatoryRepository((url, options) => $fetch<unknown>(url, { ...options, retry: 0 }))
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
function select(event: Event) {
  if (!active || loading.value || message.value || props.supplement)
    return
  const row = rows.value.find(row => row.id === (event.target as HTMLSelectElement).value)
  if (row && props.draft.ourSignatorySnapshot?.id === row.id)
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
    <select v-if="!supplement" :id="`our-signatory-${label}`" class="field-input w-full" :value="draft.ourSignatoryId ?? ''" :disabled="loading || Boolean(message)" :aria-invalid="Boolean(error)" data-testid="contract-our-signatory" @change="select">
      <option value="">
        选择已核实的真实主体
      </option>
      <option v-if="draft.ourSignatoryId && !rows.some(row => row.id === draft.ourSignatoryId)" :value="draft.ourSignatoryId">
        {{ draft.ourSignatorySnapshot?.name }}（合同原快照）
      </option>
      <option v-for="row in rows" :key="row.id" :value="row.id">
        {{ row.draft.name }}
      </option>
    </select>
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
