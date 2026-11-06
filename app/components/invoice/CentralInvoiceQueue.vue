<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { computed, shallowRef } from 'vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'

const props = defineProps<{ records: readonly CentralInvoiceRecord[], selectedId: string | null, projects: readonly { id: string, label: string }[], busy?: boolean, recognizingId?: string | null }>()
const emit = defineEmits<{ select: [id: string], upload: [files: File[], projectId: string | null], manual: [] }>()
const uploadKind = shallowRef<'project' | 'company'>('project')
const projectId = shallowRef('')
const search = shallowRef('')
const statuses = shallowRef<string[]>([])
const filterGeneration = shallowRef(0)
const statusOptions = [
  { key: 'recognizing', label: '当前会话正在识别或核对' },
  { key: 'pending', label: '识别尚未完成' },
  { key: 'failed', label: '识别失败或部分页面未识别' },
  { key: 'done', label: '识别完成' },
  { key: 'unreviewed', label: '待核对' },
]
const keyword = computed(() => search.value.trim().toLowerCase())
const matches = computed(() => props.records.filter((record) => {
  const inProgress = record.id === props.recognizingId
  const statusMatch = !statuses.value.length || statuses.value.some(status => status === 'recognizing'
    ? inProgress
    : status === 'unreviewed' ? record.reviewStatus === 'unreviewed' : !inProgress && record.ocrStatus === status)
  return statusMatch && (!keyword.value || [record.fields.invoiceNumber, record.original?.fileName, record.fields.buyer, record.fields.seller]
    .some(value => value?.toLowerCase().includes(keyword.value)))
}))
const matchedIds = computed(() => new Set(matches.value.map(record => record.id)))
const selectedOutsideSearch = computed(() => (!!keyword.value || !!statuses.value.length) && props.records.some(record => record.id === props.selectedId) && !matchedIds.value.has(props.selectedId!))
const visibleRecords = computed(() => selectedOutsideSearch.value ? props.records.filter(record => record.id === props.selectedId || matchedIds.value.has(record.id)) : matches.value)
const validProject = computed(() => props.projects.some(project => project.id === projectId.value))
const recognitionLabels: Record<CentralInvoiceRecord['ocrStatus'], string> = {
  pending: '识别尚未完成',
  failed: '识别失败或部分页面未识别',
  done: '识别完成',
}
function acceptFiles(files: File[] | null): string {
  if (!files?.length)
    return ''
  if (props.busy)
    return '当前操作尚未完成，暂不能上传。'
  if (uploadKind.value === 'project' && !validProject.value)
    return '请先选择可用的上传项目。'
  emit('upload', files, uploadKind.value === 'company' ? null : projectId.value)
  return ''
}
function clearSearch() {
  search.value = ''
  statuses.value = []
  filterGeneration.value++
}
defineExpose({ acceptFiles, clearSearch })
function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  acceptFiles(files)
}
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col rounded border border-line bg-panel" aria-label="发票队列">
    <div class="border-b border-line p-3">
      <label class="mb-2 flex min-w-0 flex-col gap-1 text-sm">
        上传归属
        <select v-model="uploadKind" :disabled="busy" class="min-w-0 border border-line rounded bg-surface p-1">
          <option value="project">项目</option>
          <option value="company">公司开销</option>
        </select>
      </label>
      <label v-if="uploadKind === 'project'" class="mb-2 flex min-w-0 flex-col gap-1 text-sm">
        上传项目
        <select v-model="projectId" :disabled="busy" class="min-w-0 border border-line rounded bg-surface p-1">
          <option value="">请选择项目</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.label }}（{{ project.id }}）</option>
        </select>
      </label>
      <label class="inline-flex cursor-pointer rounded border border-line px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-brand" :class="busy || (uploadKind === 'project' && !validProject) ? 'opacity-50' : ''">
        上传发票
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" multiple class="sr-only" :disabled="busy || (uploadKind === 'project' && !validProject)" @change="chooseFiles">
      </label>
      <button type="button" :disabled="busy" class="ml-2 rounded border border-line px-3 py-2 text-sm" @click="emit('manual')">
        手工新建
      </button>
      <p class="mt-2 text-xs text-ink-soft">
        项目票先选真实项目；公司开销归档须关联已有公司合同。支持 PDF、PNG 和 JPEG，单个文件不超过 10 MiB。
      </p>
      <KitMultiSelectFilter :key="filterGeneration" v-model="statuses" class="mt-3" label="发票状态" aria-label="筛选发票状态" :options="statusOptions" full-width :min-width="100" />
      <label class="mt-3 flex flex-col gap-1 text-sm">
        搜索发票队列
        <input v-model="search" type="search" class="min-w-0 border border-line rounded bg-surface p-1" placeholder="票号、文件名或购销方">
      </label>
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      <p v-if="!records.length" class="p-4 text-sm text-ink-faint">
        暂无发票，上传文件后可在此核对。
      </p>
      <p v-else-if="(keyword || statuses.length) && !matches.length" role="status" class="p-3 text-sm text-ink-soft">
        {{ statuses.length ? '当前已读取的发票中没有符合筛选条件的结果。' : '当前已读取的发票中没有匹配结果。' }}
      </p>
      <p v-if="selectedOutsideSearch" role="status" class="p-3 text-sm text-ink-soft">
        {{ statuses.length ? '当前选中发票不符合筛选条件，仍保留以便继续处理。' : '当前选中发票不符合搜索条件，仍保留以便继续处理。' }}
      </p>
      <ul v-if="visibleRecords.length" class="m-0 list-none p-0">
        <li v-for="record in visibleRecords" :key="record.id" class="border-b border-line">
          <button type="button" :disabled="busy" class="w-full px-3 py-3 text-left" :class="record.id === selectedId ? 'bg-surface-sink' : ''" :aria-pressed="record.id === selectedId" @click="emit('select', record.id)">
            <span class="block break-all text-sm font-600">{{ record.fields.invoiceNumber || record.original?.fileName || '未填写票号' }}</span>
            <span aria-live="polite" class="mt-1 block text-xs" :class="record.id !== recognizingId && record.ocrStatus === 'failed' ? 'text-warn-ink' : 'text-ink-soft'">{{ record.id === recognizingId ? '正在识别或核对结果' : recognitionLabels[record.ocrStatus] }}</span>
            <span v-if="record.duplicateStatus === 'duplicate'" class="mt-1 block text-xs text-warn-ink">曾标记为重复，请核对</span>
            <span class="mt-1 block text-xs text-ink-soft">{{ record.reviewStatus === 'reviewed' ? '已核对' : '待核对' }} · {{ record.accountStatus === 'archived' ? '已归档' : '未归档' }}</span>
            <span class="mt-1 block text-xs text-ink-soft">{{ record.printCount > 0 ? `已登记打印 ${record.printCount} 次` : '未登记打印' }}</span>
            <span class="mt-1 block text-xs text-ink-soft">{{ record.fields.totalAmount === null ? '价税合计未填写' : `价税合计 ${record.fields.totalAmount}` }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
