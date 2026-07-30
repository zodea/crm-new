<script setup lang="ts">
import type { PayrollDraftCreateInput } from '~/stores/payroll'
import { onBeforeRouteLeave } from 'vue-router'
import {
  payrollFiltersFromQuery,
  payrollListLocation,
} from '~/lib/payroll/navigation'

const store = usePayrollStore()
const route = useRoute()
const kit = useKitUI()
const returnFilters = shallowRef(payrollFiltersFromQuery(route.query, store.filters))
const loading = shallowRef(true)
const loadError = shallowRef('')
const submitting = shallowRef(false)
const dirty = shallowRef(false)
let allowLeave = false

useTabTitle('新建工资草稿')

const sections = [
  { key: 'basic', label: '建单范围' },
  { key: 'source', label: '工资口径' },
  { key: 'members', label: '请款组员' },
  { key: 'audit', label: '经办说明' },
]

async function load(projectId = returnFilters.value.projectId || '') {
  loading.value = true
  loadError.value = ''
  try {
    Object.assign(store.filters, returnFilters.value)
    await store.loadOptions(projectId)
    if (!returnFilters.value.projectId) {
      returnFilters.value = {
        ...returnFilters.value,
        projectId: store.filters.projectId,
      }
    }
  }
  catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    loading.value = false
  }
}

async function changeProject(projectId: string) {
  try {
    await store.loadOptions(projectId)
  }
  catch (cause) {
    kit.error(`项目人员载入失败：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

async function leaveToList() {
  if (dirty.value) {
    const accepted = await kit.confirm({
      variant: 'simple',
      title: '放弃新建工资草稿',
      message: '当前建单内容尚未生成，确认放弃并返回工资台账？',
      confirmLabel: '放弃并返回',
    })
    if (!accepted)
      return
  }
  allowLeave = true
  await navigateTo(payrollListLocation(returnFilters.value))
}

async function submit(input: PayrollDraftCreateInput) {
  if (input.formatFamily === 'B') {
    kit.error('B 类合同工资清单关系尚未接入，暂不能建单')
    return
  }
  submitting.value = true
  try {
    await store.createDraft(input)
    kit.success('工资草稿已生成')
    allowLeave = true
    await navigateTo(payrollListLocation(returnFilters.value))
  }
  catch (cause) {
    kit.error(cause instanceof Error ? cause.message : String(cause))
  }
  finally {
    submitting.value = false
  }
}

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true
  return kit.confirm({
    variant: 'simple',
    title: '放弃新建工资草稿',
    message: '当前建单内容尚未生成，确认离开？',
    confirmLabel: '放弃修改',
  })
})

onMounted(() => void load())
</script>

<template>
  <EntityFormShell
    title="新建工资草稿"
    subtitle="工资进度、最终结算与签工工资统一在工资核算工作台建单；生成后返回原筛选范围。"
    back-label="返回工资台账"
    :sections="sections"
    :state="loading ? 'loading' : loadError ? 'error' : 'ready'"
    state-title="工资建单信息载入失败"
    :state-description="loadError"
    state-action-label="重新载入"
    @back="leaveToList"
    @state-action="load()"
  >
    <PayrollDraftFormFields
      :options="store.options"
      :initial-filters="returnFilters"
      :submitting="submitting"
      @project-change="changeProject"
      @dirty-change="dirty = $event"
      @cancel="leaveToList"
      @submit="submit"
    />
  </EntityFormShell>
</template>
