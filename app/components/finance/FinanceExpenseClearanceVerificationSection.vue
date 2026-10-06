<script setup lang="ts">
import type { ExpenseClearanceInput } from './expense-clearance-input'
import type { ExpenseClearanceVerificationState } from '~/lib/finance/clearance-verification'
import type { FileRefRecord } from '~/lib/forms/file-refs'
import { financeDraftMoney } from '~/lib/finance/input-number'

const props = defineProps<{ state: ExpenseClearanceVerificationState, attachments: readonly FileRefRecord[], disabled: boolean, unsaved: boolean }>()
const emit = defineEmits<{ verify: [] }>()
const input = defineModel<ExpenseClearanceInput>({ required: true })
const source = computed(() => props.state.sources.find(row => row.id === input.value.originalExpenseLineId))
const originals = computed(() => props.attachments.filter(file => !file.deletedAt && file.ownerType === 'expense_reimbursement' && props.state.sources.some(row => row.headerId === file.ownerId) && 'sha256' in file && typeof file.sha256 === 'string' && /^[a-f0-9]{64}$/.test(file.sha256)))
const proof = computed(() => source.value?.clearanceProofs.find(row => row.id === source.value?.qualification.verificationId))
function selectExpense(event: Event) {
  const selected = props.state.sources.find(row => row.id === (event.target as HTMLSelectElement).value)
  input.value = { originalExpenseLineId: selected?.id ?? '', sourceVersion: selected?.version ?? '', sourceHash: selected?.clearanceSourceHash ?? '', basis: '', fileIds: [], items: [] }
}
function addItem() {
  input.value = { ...input.value, items: [...input.value.items, { sourceClearanceLineId: null, amount: '', matchBasis: '' }] }
}
function chooseOrigin(index: number, event: Event) {
  const key = (event.target as HTMLSelectElement).value
  const existing = proof.value?.items.find(row => row.id === key)
  input.value = { ...input.value, items: input.value.items.map((item, position) => position !== index
    ? item
    : existing
      ? { id: existing.id, sourceClearanceLineId: existing.sourceClearanceLineId, amount: String(existing.amount), matchBasis: existing.matchBasis }
      : { sourceClearanceLineId: key || null, amount: item.amount, matchBasis: item.matchBasis }) }
}
function chooseFile(id: string, event: Event) {
  input.value = { ...input.value, fileIds: (event.target as HTMLInputElement).checked ? [...input.value.fileIds, id] : input.value.fileIds.filter(value => value !== id) }
}
</script>

<template>
  <section class="min-w-0 rounded-[var(--radius-card)] border border-line bg-white p-4" aria-label="旧清偿替代核验">
    <h2 class="m-0 text-14px font-700">
      旧清偿替代核验
    </h2>
    <p class="text-12px leading-6 text-ink-muted">
      原清偿单遗失，可用银行流水、签收或原账交叉核实。核定处理份额与银行实付分别保留；未付旧份额继续承接原义务，核验不会自动产生付款。
    </p>
    <p v-if="state.message" role="status" class="break-words text-12px">
      {{ state.message }}
    </p>
    <dl v-for="frozen in state.proofs" :key="frozen.id" class="mt-3 grid min-w-0 gap-3 rounded border border-line p-3 sm:grid-cols-2" aria-label="已冻结旧清偿核验">
      <div>
        <dt class="text-12px text-ink-muted">
          核验人
        </dt><dd class="m-0 break-all">
          {{ frozen.actorId }}
        </dd>
      </div>
      <div>
        <dt class="text-12px text-ink-muted">
          核验时间
        </dt><dd class="m-0 break-all">
          {{ frozen.verifiedAt }}
        </dd>
      </div>
      <div class="min-w-0 sm:col-span-2">
        <dt class="text-12px text-ink-muted">
          已冻结替代依据
        </dt><dd class="m-0 whitespace-pre-wrap break-words">
          {{ frozen.basis }}
        </dd>
      </div>
      <div v-if="frozen.items.some(item => item.missingOriginalDocument)" class="sm:col-span-2">
        <dt class="text-12px text-ink-muted">
          原件状态
        </dt><dd class="m-0 text-12px text-warn-ink">
          已保留原单缺失记录；此核验不会补造遗失原件或银行实付。
        </dd>
      </div>
    </dl>
    <dl v-for="row in state.sources" :key="row.id" class="mt-3 grid min-w-0 gap-3 sm:grid-cols-2" aria-label="旧费用承接资格">
      <div v-for="metric in [{ label: '原费用金额', value: row.amount }, { label: '旧记录处理份额', value: row.qualification.recordedHandledAmount }, { label: '已核处理份额', value: row.qualification.verifiedHandledAmount }, { label: '可新增采用额度', value: row.qualification.newAdoptableAmount }, { label: '旧份额已付', value: row.qualification.legacyPaidAmount }, { label: '旧份额待实付', value: row.qualification.legacyUnpaidAmount }]" :key="metric.label">
        <dt class="text-12px text-ink-muted">
          {{ metric.label }}
        </dt><dd class="m-0 font-mono">
          {{ metric.value === null ? '待核实' : financeDraftMoney(metric.value) }}
        </dd>
      </div>
    </dl>
    <label class="field-block mt-3 min-w-0"><span class="field-label">选择原费用行</span><select :value="input.originalExpenseLineId" class="field-input" aria-label="选择原费用行" :disabled="disabled" @change="selectExpense"><option value="">请选择原费用</option><option v-for="row in state.sources" :key="row.id" :value="row.id">{{ row.expenseItem }} · {{ row.applicantNameSnapshot }} · {{ row.id }}</option></select></label>
    <template v-if="source">
      <p class="break-words text-12px" role="status">
        {{ source.qualification.message }}
      </p>
      <p v-if="source.qualification.legacyPaidAmount === null" class="text-12px text-ink-muted">
        原旧份额仅保原义务，实际支付另核。若已有银行实付佐证，请沿真实原支付记录关联或补登记；文件不会自动成为现金，也不能据此认定旧份额一定未付。
      </p>
      <div v-for="line in source.clearances" :key="line.id" class="min-w-0">
        <p v-for="missing in line.declaredMissingOriginals ?? []" :key="missing.id" class="break-all text-12px text-warn-ink">
          已声明缺失：{{ missing.fileName }} · {{ missing.fileSize === null ? '原大小未知' : `${missing.fileSize} 字节` }} · 原路径 {{ missing.filePath }} · {{ missing.reason }}
        </p>
      </div>
      <p v-if="source.clearances.some(row => row.missingOriginalDocument) || source.clearanceProofs.some(row => row.items.some(item => item.missingOriginalDocument))" class="text-12px text-warn-ink">
        原清偿单缺失状态保留，替代证据不表示原件已找回。
      </p>
      <fieldset class="mt-3 min-w-0" :disabled="disabled">
        <legend class="field-label">
          逐项核定旧处理份额
        </legend>
        <div v-for="(item, index) in input.items" :key="index" class="mt-3 grid min-w-0 gap-3 rounded border border-line p-3 sm:grid-cols-2">
          <label class="min-w-0 text-12px">份额来源<select :value="item.id ?? item.sourceClearanceLineId ?? ''" class="field-input mt-1" :aria-label="`第 ${index + 1} 项份额来源`" @change="chooseOrigin(index, $event)"><option value="">补证核定（原清偿记录缺失）</option><option v-for="row in source.clearances" :key="row.id" :value="row.id">原记录 {{ row.id }} · {{ row.amount === null ? '金额待核实' : financeDraftMoney(row.amount) }}</option><option v-for="row in proof?.items ?? []" :key="row.id" :value="row.id">沿用已核份额 · {{ row.matchBasis }}</option></select></label>
          <label class="min-w-0 text-12px">核定处理金额<input v-model="item.amount" class="field-input mt-1" inputmode="decimal" :aria-label="`第 ${index + 1} 项核定处理金额`"></label>
          <label class="min-w-0 text-12px sm:col-span-2">与原费用的匹配依据<textarea v-model="item.matchBasis" class="field-input mt-1" :aria-label="`第 ${index + 1} 项原费用匹配依据`" /></label>
          <KitButton type="button" @click="input.items = input.items.filter((_row, position) => position !== index)">
            移除此核定项
          </KitButton>
        </div>
        <KitButton class="mt-3" type="button" @click="addItem">
          新增核定份额
        </KitButton>
        <label class="field-block mt-3"><span class="field-label">替代核验说明</span><textarea v-model="input.basis" class="field-input min-h-80px" aria-label="替代核验说明" /></label>
      </fieldset>
      <fieldset class="mt-3 min-w-0" :disabled="disabled">
        <legend class="field-label">
          采用已保存替代证据
        </legend>
        <label v-for="file in originals" :key="file.id" class="mt-2 flex min-w-0 items-start gap-2 text-12px"><input type="checkbox" :checked="input.fileIds.includes(file.id)" :aria-label="`替代证据 ${file.fileName}`" @change="chooseFile(file.id, $event)"><span class="break-all">{{ file.fileName }} · {{ file.fileSize }} 字节</span></label>
        <p v-if="!originals.length" class="text-12px text-ink-muted">
          先保存真实替代文件；原缺件元数据不能作为证明。
        </p>
      </fieldset>
      <p v-if="unsaved" class="text-12px text-warn-ink">
        请先保存费用编辑和新增原件，再核验已保存来源。
      </p>
      <KitButton class="mt-4" type="button" :disabled="disabled || unsaved || !originals.length" @click="emit('verify')">
        保存旧清偿替代核验
      </KitButton>
    </template>
    <p v-else class="text-12px text-ink-muted">
      请选择此费用头的真实原费用行。找不到依据时保持待核实，不按零或原额放行。
    </p>
  </section>
</template>
