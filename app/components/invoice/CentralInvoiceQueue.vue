<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { computed, shallowRef } from 'vue'

const props = defineProps<{ records: readonly CentralInvoiceRecord[], selectedId: string | null, projects: readonly { id: string, label: string }[], busy?: boolean, recognizingId?: string | null }>()
const emit = defineEmits<{ select: [id: string], upload: [files: File[], projectId: string | null], manual: [] }>()
const uploadKind = shallowRef<'project' | 'company'>('project')
const projectId = shallowRef('')
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
defineExpose({ acceptFiles })
function chooseFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  acceptFiles(files)
}
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-col rounded border border-line bg-panel" aria-label="发票队列">
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
    </div>
    <div class="min-h-0 flex-1 overflow-auto">
      <p v-if="!records.length" class="p-4 text-sm text-ink-faint">
        暂无发票，上传文件后可在此核对。
      </p>
      <ul v-else class="m-0 list-none p-0">
        <li v-for="record in records" :key="record.id" class="border-b border-line">
          <button type="button" :disabled="busy" class="w-full px-3 py-3 text-left" :class="record.id === selectedId ? 'bg-surface-sink' : ''" :aria-pressed="record.id === selectedId" @click="emit('select', record.id)">
            <span class="block break-all text-sm font-600">{{ record.fields.invoiceNumber || record.original?.fileName || '未填写票号' }}</span>
            <span aria-live="polite" class="mt-1 block text-xs" :class="record.id !== recognizingId && record.ocrStatus === 'failed' ? 'text-warn-ink' : 'text-ink-soft'">{{ record.id === recognizingId ? '正在识别或核对结果' : recognitionLabels[record.ocrStatus] }}</span>
            <span class="mt-1 block text-xs text-ink-soft">{{ record.reviewStatus === 'reviewed' ? '已核对' : '待核对' }} · {{ record.accountStatus === 'archived' ? '已归档' : '未归档' }}</span>
            <span class="mt-1 block text-xs text-ink-soft">{{ record.printCount > 0 ? `已登记打印 ${record.printCount} 次` : '未登记打印' }}</span>
            <span class="mt-1 block text-xs text-ink-soft">{{ record.fields.totalAmount === null ? '价税合计未填写' : `价税合计 ${record.fields.totalAmount}` }}</span>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
