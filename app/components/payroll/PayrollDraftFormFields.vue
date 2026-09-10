<script setup lang="ts">
import type {
  PayrollWorkbenchOptions,
  WageFormatFamily,
  WagePeriodKind,
  WageStatementFilter,
  WageStatementPurpose,
} from '~/lib/payroll/statements'
import type { WageQuantitySource } from '~/lib/quantity/wage-source'
import type { PayrollDraftCreateInput } from '~/stores/payroll'
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import { wageSourceLabel } from '~/lib/payroll/presentation'

const props = defineProps<{
  options: PayrollWorkbenchOptions
  initialFilters: WageStatementFilter
  submitting?: boolean
}>()

const emit = defineEmits<{
  submit: [input: PayrollDraftCreateInput]
  cancel: []
  projectChange: [projectId: string]
  dirtyChange: [dirty: boolean]
}>()

const draft = reactive({
  projectId: props.initialFilters.projectId ?? '',
  crewId: props.initialFilters.crewId ?? '',
  leaderWorkerId: '',
  month: props.initialFilters.month || new Date().toISOString().slice(0, 7),
  purpose: 'advance' as WageStatementPurpose,
  periodKind: 'monthly' as WagePeriodKind,
  formatFamily: 'A' as WageFormatFamily,
  quantitySource: 'provisional' as WageQuantitySource,
  payRatioPercent: 80,
  memberWorkerIds: [] as string[],
  dailyRate: 400,
  overtimeRate: 50,
  c2Rate: 350,
  dayworkRuleText: '当日用工由证明人确认后生效；半工按 0.5 工计。',
  adjustmentReason: '',
  operatorName: '',
})

const errors = shallowRef<Record<string, string>>({})
const initialSnapshot = shallowRef('')
const projectInput = useTemplateRef<HTMLSelectElement>('projectInput')
const monthInput = useTemplateRef<HTMLInputElement>('monthInput')
const leaderInput = useTemplateRef<HTMLSelectElement>('leaderInput')
const formatInput = useTemplateRef<HTMLSelectElement>('formatInput')
const payRatioInput = useTemplateRef<HTMLInputElement>('payRatioInput')
const c1DailyRateInput = useTemplateRef<HTMLInputElement>('c1DailyRateInput')
const c1OvertimeRateInput = useTemplateRef<HTMLInputElement>('c1OvertimeRateInput')
const c2RateInput = useTemplateRef<HTMLInputElement>('c2RateInput')
const c2RuleInput = useTemplateRef<HTMLInputElement>('c2RuleInput')
const eligibleWorkers = computed(() =>
  props.options.workers.filter(worker => !draft.crewId || worker.crewId === draft.crewId),
)
const eligibleMembers = computed(() => {
  const leader = eligibleWorkers.value.find(worker => worker.id === draft.leaderWorkerId)
  return eligibleWorkers.value.filter(worker =>
    worker.id !== draft.leaderWorkerId && worker.crewId === leader?.crewId,
  )
})
const activeC2Config = computed(() =>
  props.options.c2SubjectConfigs.find(config =>
    config.projectId === draft.projectId
    && config.leaderWorkerId === draft.leaderWorkerId,
  ),
)
const sourceLocked = computed(() =>
  draft.purpose === 'final'
  || draft.periodKind !== 'monthly'
  || draft.formatFamily === 'C1'
  || draft.formatFamily === 'C2',
)

watch(draft, (value) => {
  if (initialSnapshot.value)
    emit('dirtyChange', JSON.stringify(value) !== initialSnapshot.value)
}, { deep: true })

watch(eligibleWorkers, (workers) => {
  if (!workers.some(worker => worker.id === draft.leaderWorkerId))
    draft.leaderWorkerId = workers[0]?.id ?? ''
}, { immediate: true })

watch(() => draft.crewId, () => {
  draft.memberWorkerIds = []
})

watch(() => draft.purpose, (purpose) => {
  if (purpose === 'final')
    draft.quantitySource = 'field'
  if (purpose === 'advance' && draft.periodKind !== 'monthly')
    draft.periodKind = 'monthly'
})

watch(() => draft.periodKind, (periodKind) => {
  if (periodKind === 'monthly')
    return
  draft.purpose = 'final'
  draft.quantitySource = 'field'
  draft.payRatioPercent = periodKind === 'retention' ? 100 : 95
})

watch(() => draft.formatFamily, (formatFamily) => {
  if (formatFamily === 'A')
    return
  if (formatFamily === 'B')
    return
  draft.periodKind = 'monthly'
  draft.purpose = 'advance'
  draft.quantitySource = 'field'
  if (formatFamily === 'C2') {
    draft.payRatioPercent = 100
    if (activeC2Config.value) {
      draft.c2Rate = activeC2Config.value.unitRate
      draft.dayworkRuleText = activeC2Config.value.ruleText
    }
  }
})

watch(() => draft.leaderWorkerId, () => {
  draft.memberWorkerIds = draft.memberWorkerIds.filter(id =>
    eligibleMembers.value.some(worker => worker.id === id),
  )
})

watch(activeC2Config, (config) => {
  if (!config || draft.formatFamily !== 'C2')
    return
  draft.c2Rate = config.unitRate
  draft.dayworkRuleText = config.ruleText
}, { immediate: true })

onMounted(() => {
  initialSnapshot.value = JSON.stringify(draft)
  emit('dirtyChange', false)
})

function updateProject(event: Event) {
  draft.projectId = (event.target as HTMLSelectElement).value
  draft.leaderWorkerId = ''
  draft.memberWorkerIds = []
  emit('projectChange', draft.projectId)
}

function fieldError(name: string) {
  return errors.value[name] ?? ''
}

function focusFirstError(next: Record<string, string>) {
  const firstError = Object.keys(next)[0]
  if (!firstError)
    return
  void nextTick(() => {
    const target = {
      projectId: projectInput,
      month: monthInput,
      leaderWorkerId: leaderInput,
      formatFamily: formatInput,
      payRatioPercent: payRatioInput,
      dailyRate: c1DailyRateInput,
      overtimeRate: c1OvertimeRateInput,
      c2Rate: c2RateInput,
      rule: c2RuleInput,
    }[firstError]
    target?.value?.focus()
  })
}

function validate(): boolean {
  const next: Record<string, string> = {}
  if (!draft.projectId)
    next.projectId = '请选择项目'
  if (!draft.month)
    next.month = '请选择月份'
  if (!draft.leaderWorkerId)
    next.leaderWorkerId = '请选择请款负责人'
  if (draft.formatFamily === 'B')
    next.formatFamily = 'B 类工资已退役，请选择 A、C1 或 C2'
  if (!Number.isFinite(draft.payRatioPercent) || draft.payRatioPercent < 0 || draft.payRatioPercent > 100)
    next.payRatioPercent = '发放比例应为 0–100'
  if (draft.formatFamily === 'C1') {
    if (!Number.isFinite(draft.dailyRate) || draft.dailyRate < 0)
      next.dailyRate = 'C1 默认日薪不能为负数'
    if (!Number.isFinite(draft.overtimeRate) || draft.overtimeRate < 0)
      next.overtimeRate = 'C1 默认加班时薪不能为负数'
  }
  if (
    draft.formatFamily === 'C2'
    && (!Number.isFinite(draft.c2Rate) || draft.c2Rate <= 0)
  ) {
    next.c2Rate = 'C2 大工单价必须大于 0'
  }
  if (draft.formatFamily === 'C2' && !draft.dayworkRuleText.trim())
    next.rule = '请填写签工确认规则'
  errors.value = next
  focusFirstError(next)
  return Object.keys(next).length === 0
}

function submit() {
  if (!validate())
    return
  emit('submit', {
    projectId: draft.projectId,
    crewId: draft.crewId || null,
    leaderWorkerId: draft.leaderWorkerId,
    month: draft.month,
    purpose: draft.purpose,
    periodKind: draft.periodKind,
    formatFamily: draft.formatFamily,
    quantitySource: draft.quantitySource,
    payRatio: draft.payRatioPercent / 100,
    memberWorkerIds: [...draft.memberWorkerIds],
    dailyRate: draft.formatFamily === 'C1' ? draft.dailyRate : undefined,
    overtimeRate: draft.formatFamily === 'C1' ? draft.overtimeRate : undefined,
    c2Rate: draft.formatFamily === 'C2' ? draft.c2Rate : undefined,
    dayworkRuleText: draft.formatFamily === 'C2' ? draft.dayworkRuleText : undefined,
    adjustmentReason: draft.adjustmentReason.trim(),
    operatorName: draft.operatorName.trim(),
  })
}
</script>

<template>
  <form class="grid min-w-0 gap-4" data-testid="payroll-draft-form" @submit.prevent="submit">
    <section id="section-basic" class="panel scroll-mt-4 p-4">
      <div class="mb-3">
        <h2 class="text-14px font-800 text-ink">
          建单范围
        </h2>
        <p class="mt-1 text-11px leading-5 text-ink-faint">
          先确定项目、月份与负责人；班组用于限制同一请款簿内的工人范围。
        </p>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label class="field">
          <span>项目 <b aria-hidden="true">*</b></span>
          <select ref="projectInput" :value="draft.projectId" required :disabled="submitting" @change="updateProject">
            <option value="" disabled>请选择项目</option>
            <option v-for="project in options.projects" :key="project.id" :value="project.id">
              {{ project.name }}<template v-if="project.code"> · {{ project.code }}</template>
            </option>
          </select>
          <small v-if="fieldError('projectId')" role="alert">{{ fieldError('projectId') }}</small>
        </label>
        <label class="field">
          <span>工资月份 <b aria-hidden="true">*</b></span>
          <input ref="monthInput" v-model="draft.month" type="month" required :disabled="submitting">
          <small v-if="fieldError('month')" role="alert">{{ fieldError('month') }}</small>
        </label>
        <label class="field">
          <span>责任班组</span>
          <select v-model="draft.crewId" :disabled="submitting">
            <option value="">个人责任</option>
            <option v-for="crew in options.crews" :key="crew.id" :value="crew.id">
              {{ crew.name }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>请款负责人 <b aria-hidden="true">*</b></span>
          <select ref="leaderInput" v-model="draft.leaderWorkerId" required :disabled="submitting">
            <option value="" disabled>请选择负责人</option>
            <option v-for="worker in eligibleWorkers" :key="worker.id" :value="worker.id">
              {{ worker.name }}
            </option>
          </select>
          <small v-if="fieldError('leaderWorkerId')" role="alert">{{ fieldError('leaderWorkerId') }}</small>
        </label>
      </div>
    </section>

    <section id="section-source" class="panel scroll-mt-4 p-4">
      <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-14px font-800 text-ink">
            工资口径
          </h2>
          <p class="mt-1 text-11px leading-5 text-ink-faint">
            合同量只做收入、量差与毛利对照，不进入 A 类工资取数。
          </p>
        </div>
        <span class="chip chip-brand">A / C1 / C2 可用</span>
      </div>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label class="field">
          <span>格式族</span>
          <select ref="formatInput" v-model="draft.formatFamily" aria-label="工资格式族" :disabled="submitting">
            <option value="A">A · 户型派生</option>
            <option value="C1">C1 · 月薪时工</option>
            <option value="C2">C2 · 零星签工</option>
          </select>
          <small v-if="fieldError('formatFamily')" role="alert">{{ fieldError('formatFamily') }}</small>
        </label>
        <label class="field">
          <span>单据用途</span>
          <select v-model="draft.purpose" aria-label="单据用途" :disabled="submitting">
            <option value="advance">进度预付</option>
            <option value="final">最终结算</option>
          </select>
        </label>
        <label class="field">
          <span>期间档</span>
          <select v-model="draft.periodKind" aria-label="工资期间档" :disabled="submitting">
            <option value="monthly">月度进度</option>
            <option value="settlement" :disabled="draft.formatFamily !== 'A'">结算 95%</option>
            <option value="retention" :disabled="draft.formatFamily !== 'A'">尾款 100%</option>
          </select>
        </label>
        <label class="field">
          <span>工资取数口径</span>
          <select
            v-model="draft.quantitySource"
            aria-label="工资取数口径"
            :disabled="submitting || sourceLocked"
          >
            <option v-if="draft.formatFamily === 'A'" value="provisional">暂估量</option>
            <option value="field">{{ wageSourceLabel({ formatFamily: draft.formatFamily, quantitySource: 'field' }) }}</option>
          </select>
        </label>
        <label class="field">
          <span>本月发放比例</span>
          <input
            ref="payRatioInput"
            v-model.number="draft.payRatioPercent"
            aria-label="本月发放比例"
            type="number"
            min="0"
            max="100"
            step="1"
            :disabled="submitting || draft.formatFamily === 'C2'"
          >
          <small v-if="fieldError('payRatioPercent')" role="alert">{{ fieldError('payRatioPercent') }}</small>
        </label>
        <template v-if="draft.formatFamily === 'C1'">
          <label class="field">
            <span>档案未配置时默认日薪</span>
            <input
              ref="c1DailyRateInput"
              v-model.number="draft.dailyRate"
              aria-label="C1 日薪"
              :aria-invalid="Boolean(fieldError('dailyRate'))"
              :aria-describedby="fieldError('dailyRate') ? 'payroll-c1-daily-rate-error' : undefined"
              type="number"
              min="0"
              step="0.01"
              :disabled="submitting"
            >
            <small v-if="fieldError('dailyRate')" id="payroll-c1-daily-rate-error" role="alert">
              {{ fieldError('dailyRate') }}
            </small>
          </label>
          <label class="field">
            <span>档案未配置时默认加班时薪</span>
            <input
              ref="c1OvertimeRateInput"
              v-model.number="draft.overtimeRate"
              aria-label="C1 加班时薪"
              :aria-invalid="Boolean(fieldError('overtimeRate'))"
              :aria-describedby="fieldError('overtimeRate') ? 'payroll-c1-overtime-rate-error' : undefined"
              type="number"
              min="0"
              step="0.01"
              :disabled="submitting"
            >
            <small v-if="fieldError('overtimeRate')" id="payroll-c1-overtime-rate-error" role="alert">
              {{ fieldError('overtimeRate') }}
            </small>
          </label>
        </template>
        <template v-else-if="draft.formatFamily === 'C2'">
          <label class="field">
            <span>默认大工单价</span>
            <input
              ref="c2RateInput"
              v-model.number="draft.c2Rate"
              aria-label="C2 大工单价"
              :aria-invalid="Boolean(fieldError('c2Rate'))"
              :aria-describedby="fieldError('c2Rate') ? 'payroll-c2-rate-error' : undefined"
              type="number"
              min="0.01"
              step="0.01"
              :disabled="submitting"
            >
            <small v-if="fieldError('c2Rate')" id="payroll-c2-rate-error" role="alert">
              {{ fieldError('c2Rate') }}
            </small>
          </label>
          <label class="field md:col-span-2">
            <span>签工确认规则</span>
            <input ref="c2RuleInput" v-model="draft.dayworkRuleText" aria-label="C2 签工确认规则" type="text" :disabled="submitting">
            <small v-if="fieldError('rule')" role="alert">{{ fieldError('rule') }}</small>
          </label>
        </template>
      </div>
      <div class="mt-3 rounded-md border border-line bg-canvas px-3 py-2 text-11px leading-5 text-ink-soft">
        <template v-if="draft.formatFamily === 'C2'">
          C2 只汇总本月已确认签工，待确认记录不会计薪；负责人、项目、单价与规则会形成配置快照。
        </template>
        <template v-else-if="draft.formatFamily === 'C1'">
          C1 按本月考勤工时生成，只允许月度期间，并固定使用现场考勤事实。
        </template>
        <template v-else>
          A 类进度预付可选暂估量或现场复核量；最终结算、95% 结算及 100% 尾款固定使用现场复核量。
        </template>
      </div>
    </section>

    <section id="section-members" class="panel scroll-mt-4 p-4">
      <h2 class="text-14px font-800 text-ink">
        请款簿组员
      </h2>
      <p class="mt-1 text-11px leading-5 text-ink-faint">
        只显示与负责人同班组的工人；页面不展示身份证、银行卡等敏感档案。
      </p>
      <fieldset class="mt-3">
        <legend class="sr-only">
          选择请款簿组员
        </legend>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="worker in eligibleMembers"
            :key="worker.id"
            class="inline-flex items-center gap-2 rounded border border-line px-3 py-2 text-12px text-ink"
          >
            <input v-model="draft.memberWorkerIds" type="checkbox" :value="worker.id" :disabled="submitting">
            {{ worker.name }}
          </label>
          <span v-if="!eligibleMembers.length" class="text-11px text-ink-faint">
            当前负责人范围暂无可选组员
          </span>
        </div>
      </fieldset>
    </section>

    <section id="section-audit" class="panel scroll-mt-4 p-4">
      <h2 class="text-14px font-800 text-ink">
        经办与调整说明
      </h2>
      <div class="mt-3 grid gap-3 md:grid-cols-3">
        <label class="field">
          <span>经办人</span>
          <input v-model="draft.operatorName" aria-label="工资经办人" type="text" placeholder="用于发放快照审计" :disabled="submitting">
        </label>
        <label class="field md:col-span-2">
          <span>人工调整原因</span>
          <input v-model="draft.adjustmentReason" aria-label="工资调整原因" type="text" placeholder="如有手工调价，请填写原因" :disabled="submitting">
        </label>
      </div>
    </section>

    <FormFooter
      :actions="['cancel', 'save']"
      :labels="{ save: '生成工资草稿' }"
      :dirty="true"
      :loading-action="submitting ? 'save' : null"
      @action="$event === 'cancel' ? emit('cancel') : submit()"
    />
  </form>
</template>

<style scoped>
.field {
  display: grid;
  min-width: 0;
  gap: .375rem;
  color: var(--ink-soft);
  font-size: .75rem;
  font-weight: 700;
}

.field b {
  color: var(--danger);
}

.field select,
.field input {
  height: 2.375rem;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  background: white;
  padding: 0 .625rem;
  color: var(--ink);
  font-size: .8125rem;
  font-weight: 500;
}

.field small {
  color: var(--danger);
  font-weight: 500;
}
</style>
