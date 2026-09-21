<script setup lang="ts">
import type { PayrollContext, PayrollStatementRow } from '~/lib/payroll/central-contract'
import type { PayrollFrozenDocument, PayrollWorkbookEntry, PayrollWorkbookGap, PayrollWorkbookGroup } from '~/lib/payroll/complete-workbook'
import { computed, ref, shallowRef, watch } from 'vue'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '~/components/ui/dialog'
import { createPayrollCompleteWorkbook, createPayrollMonthlyArchive, payrollWorkbookSubjectKey, payrollWorkbookSubjectLabel } from '~/lib/payroll/complete-workbook'

const props = defineProps<{ open: boolean, context: PayrollContext, projectId: string, projectName: string }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()
const kit = useKitUI()
const repository = () => useNuxtApp().$repositories.payroll
const mode = ref<'leader-cycle' | 'project-month'>('leader-cycle')
const subjectKey = ref('')
const released = shallowRef<PayrollStatementRow[]>([])
const loading = ref(false)
const exporting = ref(false)
const error = ref('')

const subjects = computed(() => [...new Map(released.value.map(row => [payrollWorkbookSubjectKey(row), { key: payrollWorkbookSubjectKey(row), label: payrollWorkbookSubjectLabel(row) }])).values()])
const selectedRows = computed(() => mode.value === 'leader-cycle' ? released.value.filter(row => payrollWorkbookSubjectKey(row) === subjectKey.value) : released.value)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const read = await repository().list({ origin: props.context.origin, projectId: props.projectId })
    released.value = read.rows.filter(row => row.projectId === props.projectId && row.recordKind === 'central' && !row.deletedAt && row.status === 'released' && ['A', 'C1', 'C2'].includes(row.formatFamily))
    if (!subjects.value.some(subject => subject.key === subjectKey.value))
      subjectKey.value = subjects.value[0]?.key ?? ''
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { loading.value = false }
}

async function output(row: PayrollStatementRow): Promise<PayrollFrozenDocument | string> {
  const query = { origin: props.context.origin, projectId: props.projectId, month: row.month }
  const read = row.formatFamily === 'A'
    ? await repository().aOutput(query, row.id)
    : row.formatFamily === 'C1'
      ? await repository().c1Output(query, row.id)
      : await repository().c2Output(query, row.id)
  return read.state === 'available' ? read.document : read.reasons.join('；') || '冻结工资输出不可用'
}

async function collect(rows: PayrollStatementRow[]): Promise<{ entries: PayrollWorkbookEntry[], gaps: PayrollWorkbookGap[] }> {
  const reads = await Promise.all(rows.map(async row => ({ row, result: await output(row) })))
  const entries: PayrollWorkbookEntry[] = []
  const gaps: PayrollWorkbookGap[] = []
  for (const read of reads) {
    if (typeof read.result === 'string')
      gaps.push({ statementId: read.row.id, month: read.row.month, formatFamily: read.row.formatFamily, reason: read.result })
    else
      entries.push({ row: read.row, document: read.result })
  }
  return { entries, gaps }
}

async function exportArchive() {
  if (!selectedRows.value.length)
    return
  exporting.value = true
  error.value = ''
  try {
    const { entries, gaps } = await collect(selectedRows.value)
    if (!entries.length)
      throw new Error('所选范围没有可用的已冻结工资，未生成空工作簿')
    if (mode.value === 'leader-cycle') {
      const ids = entries.map(entry => entry.document.id)
      const actualLedger = await repository().actualLedger({ origin: props.context.origin, projectId: props.projectId }, { projectId: props.projectId, originalStatementIds: ids })
      const subject = subjects.value.find(item => item.key === subjectKey.value)
      await kit.exportFile(createPayrollCompleteWorkbook({ key: subjectKey.value, label: subject?.label ?? `${props.projectName}-负责人全周期`, entries, actualLedger }, gaps))
      return
    }
    const byMonth = new Map<string, PayrollWorkbookEntry[]>()
    for (const entry of entries) {
      const monthEntries = byMonth.get(entry.document.month) ?? []
      monthEntries.push(entry)
      byMonth.set(entry.document.month, monthEntries)
    }
    const groups: PayrollWorkbookGroup[] = await Promise.all([...byMonth.entries()].sort(([left], [right]) => left.localeCompare(right)).map(async ([month, monthEntries]) => ({
      key: month,
      label: `${props.projectName}-${month}`,
      entries: monthEntries,
      actualLedger: await repository().actualLedger({ origin: props.context.origin, projectId: props.projectId, month }, { projectId: props.projectId, originalStatementIds: monthEntries.map(entry => entry.document.id) }),
    })))
    await kit.exportFile(createPayrollMonthlyArchive(props.projectName, groups, gaps))
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause) }
  finally { exporting.value = false }
}

watch(() => props.open, (open) => {
  if (open)
    void load()
}, { immediate: true })
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="flex max-h-[min(760px,calc(100dvh-24px))] w-[min(760px,calc(100dvw-24px))] min-w-0 flex-col overflow-hidden p-0" @escape-key-down="exporting && $event.preventDefault()" @interact-outside="exporting && $event.preventDefault()">
      <div class="border-b border-line px-5 py-4">
        <DialogTitle>完整工资工作簿</DialogTitle>
        <DialogDescription class="mt-1">
          从已发工资冻结正文和同一范围实际收付生成；不会读取当前量价重算旧月。
        </DialogDescription>
      </div>
      <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        <div class="grid gap-2 sm:grid-cols-2">
          <label class="rounded-lg border border-line p-3 text-12px"><input v-model="mode" type="radio" value="leader-cycle" :disabled="exporting"> <strong>负责人全周期一册</strong><span class="mt-1 block text-ink-soft">按负责人、格式与 A 请款簿稳定身份汇集所有已发月份。</span></label>
          <label class="rounded-lg border border-line p-3 text-12px"><input v-model="mode" type="radio" value="project-month" :disabled="exporting"> <strong>项目按月归档</strong><span class="mt-1 block text-ink-soft">ZIP 中创建真实月份目录，每月一份完整工作簿。</span></label>
        </div>
        <label v-if="mode === 'leader-cycle'" class="grid gap-1 text-12px">负责人 / 请款簿<select v-model="subjectKey" class="field-input" :disabled="loading || exporting"><option v-for="subject in subjects" :key="subject.key" :value="subject.key">{{ subject.label }}</option></select></label>
        <div class="rounded-lg border border-line bg-surface-soft p-3 text-12px">
          <p>项目：{{ projectName }}</p>
          <p class="mt-1">
            当前范围：{{ selectedRows.length }} 份已发工资。
          </p>
          <p class="mt-1 text-warning-strong">
            正式编号暂不分配；编号时点与旧号接续留待业务裁定。工作簿会明确标记“编号待定”。
          </p>
          <p class="mt-1 text-warning-strong">
            实名名册、证件照和银行卡照暂不归档；归档时点与最小授权留待业务裁定，旧缺原件不会补造。
          </p>
        </div>
        <p v-if="loading" role="status" class="text-12px">
          正在读取项目全部已发工资…
        </p>
        <p v-else-if="!released.length" class="text-12px text-ink-soft">
          该项目没有可用于完整工作簿的 A/C1/C2 已发工资。
        </p>
        <p v-if="error" role="alert" class="rounded-md bg-danger/10 px-3 py-2 text-12px text-danger">
          {{ error }}
        </p>
      </div>
      <DialogFooter class="border-t border-line px-5 py-3">
        <KitButton :disabled="loading || exporting || !selectedRows.length" @click="exportArchive">
          {{ exporting ? '正在核对并生成…' : mode === 'leader-cycle' ? '生成全周期工作簿' : '生成按月 ZIP 归档' }}
        </KitButton>
        <KitButton variant="secondary" :disabled="exporting" @click="emit('update:open', false)">
          关闭
        </KitButton>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
