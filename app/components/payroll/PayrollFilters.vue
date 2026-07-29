<script setup lang="ts">
import type {
  PayrollWorkbenchOptions,
  WageFormatFamily,
  WagePeriodKind,
  WageStatementFilter,
  WageStatementPurpose,
} from '~/lib/payroll/statements'
import type { WageQuantitySource } from '~/lib/quantity/wage-source'
import { computed, reactive, ref, watch } from 'vue'

const props = defineProps<{
  options: PayrollWorkbenchOptions
  filters: WageStatementFilter
}>()

const emit = defineEmits<{
  'update:filters': [filters: WageStatementFilter]
  'create': [input: {
    projectId: string
    crewId: string | null
    leaderWorkerId: string
    month: string
    purpose: WageStatementPurpose
    periodKind: WagePeriodKind
    formatFamily: WageFormatFamily
    quantitySource: WageQuantitySource
    payRatio: number
    memberWorkerIds: string[]
    dailyRate?: number
    overtimeRate?: number
    adjustmentReason?: string
    operatorName?: string
  }]
}>()

const open = ref(false)
const draft = reactive({
  projectId: props.filters.projectId ?? '',
  crewId: props.filters.crewId ?? '',
  leaderWorkerId: '',
  month: props.filters.month ?? new Date().toISOString().slice(0, 7),
  purpose: 'advance' as WageStatementPurpose,
  periodKind: 'monthly' as WagePeriodKind,
  formatFamily: 'A' as WageFormatFamily,
  quantitySource: 'provisional' as WageQuantitySource,
  payRatioPercent: 80,
  memberWorkerIds: [] as string[],
  dailyRate: 400,
  overtimeRate: 50,
  adjustmentReason: '',
  operatorName: '',
})

const eligibleWorkers = computed(() =>
  props.options.workers.filter(worker => !draft.crewId || worker.crewId === draft.crewId),
)
const eligibleMembers = computed(() =>
  eligibleWorkers.value.filter((worker) => {
    if (worker.id === draft.leaderWorkerId)
      return false
    const leader = eligibleWorkers.value.find(candidate => candidate.id === draft.leaderWorkerId)
    return worker.crewId === leader?.crewId
  }),
)

watch(() => props.filters, (filters) => {
  draft.projectId = filters.projectId ?? draft.projectId
  draft.crewId = filters.crewId ?? draft.crewId
  draft.month = filters.month ?? draft.month
}, { deep: true })

watch(() => draft.crewId, () => {
  if (!eligibleWorkers.value.some(worker => worker.id === draft.leaderWorkerId))
    draft.leaderWorkerId = eligibleWorkers.value[0]?.id ?? ''
}, { immediate: true })

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
  if (formatFamily !== 'C1')
    return
  draft.periodKind = 'monthly'
  draft.purpose = 'advance'
})

watch(() => draft.leaderWorkerId, () => {
  draft.memberWorkerIds = draft.memberWorkerIds.filter(id =>
    eligibleMembers.value.some(worker => worker.id === id),
  )
})

function patchFilter(key: keyof WageStatementFilter, value: string) {
  emit('update:filters', { ...props.filters, [key]: value })
}

function submit() {
  if (!draft.projectId || !draft.leaderWorkerId)
    return
  emit('create', {
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
    adjustmentReason: draft.adjustmentReason,
    operatorName: draft.operatorName,
  })
  open.value = false
}
</script>

<template>
  <section class="panel p-4" aria-label="工资筛选与建单">
    <div class="flex flex-wrap items-end gap-3">
      <label class="field">
        <span>项目</span>
        <select
          :value="filters.projectId"
          @change="patchFilter('projectId', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部项目</option>
          <option v-for="project in options.projects" :key="project.id" :value="project.id">
            {{ project.name }}<template v-if="project.code"> · {{ project.code }}</template>
          </option>
        </select>
      </label>
      <label class="field">
        <span>月份</span>
        <input
          type="month"
          :value="filters.month"
          @input="patchFilter('month', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="field">
        <span>班组</span>
        <select
          :value="filters.crewId"
          @change="patchFilter('crewId', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部班组</option>
          <option v-for="crew in options.crews" :key="crew.id" :value="crew.id">
            {{ crew.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>状态</span>
        <select
          :value="filters.status"
          @change="patchFilter('status', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="checked">已核对</option>
          <option value="released">已发放</option>
        </select>
      </label>
      <button type="button" class="btn-primary ml-auto" @click="open = !open">
        生成月度草稿
      </button>
      <NuxtLink to="/subcontract/attendance" class="btn-secondary">
        打开考勤
      </NuxtLink>
    </div>

    <form v-if="open" class="mt-4 grid gap-3 border-t border-line pt-4 md:grid-cols-3 xl:grid-cols-6" @submit.prevent="submit">
      <label class="field">
        <span>建单项目</span>
        <select v-model="draft.projectId" required>
          <option v-for="project in options.projects" :key="project.id" :value="project.id">
            {{ project.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>责任班组</span>
        <select v-model="draft.crewId">
          <option value="">个人责任</option>
          <option v-for="crew in options.crews" :key="crew.id" :value="crew.id">
            {{ crew.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>请款负责人</span>
        <select v-model="draft.leaderWorkerId" required>
          <option v-for="worker in eligibleWorkers" :key="worker.id" :value="worker.id">
            {{ worker.name }}
          </option>
        </select>
      </label>
      <label class="field">
        <span>格式族</span>
        <select v-model="draft.formatFamily" aria-label="工资格式族">
          <option value="A">A · 户型派生</option>
          <option value="B" disabled>B · 合同清单直报（后续）</option>
          <option value="C1">C1 · 月薪时工</option>
          <option value="C2" disabled>C2 · 零星签工（后续）</option>
        </select>
      </label>
      <label class="field">
        <span>单据用途</span>
        <select v-model="draft.purpose" aria-label="单据用途">
          <option value="advance">进度预付</option>
          <option value="final">最终结算</option>
        </select>
      </label>
      <label class="field">
        <span>期间档</span>
        <select v-model="draft.periodKind" aria-label="工资期间档">
          <option value="monthly">月度进度</option>
          <option value="settlement" :disabled="draft.formatFamily === 'C1'">结算 95%</option>
          <option value="retention" :disabled="draft.formatFamily === 'C1'">尾款 100%</option>
        </select>
      </label>
      <label class="field">
        <span>工资取数口径</span>
        <select v-model="draft.quantitySource" aria-label="工资取数口径" :disabled="draft.purpose === 'final'">
          <option value="provisional">暂估量</option>
          <option value="field">现场复核量</option>
        </select>
      </label>
      <label class="field">
        <span>本月发放比例</span>
        <input v-model.number="draft.payRatioPercent" type="number" min="0" max="100" step="1">
      </label>
      <template v-if="draft.formatFamily === 'C1'">
        <label class="field">
          <span>档案未配置时默认日薪</span>
          <input v-model.number="draft.dailyRate" aria-label="C1 日薪" type="number" min="0" step="0.01">
        </label>
        <label class="field">
          <span>档案未配置时默认加班时薪</span>
          <input v-model.number="draft.overtimeRate" aria-label="C1 加班时薪" type="number" min="0" step="0.01">
        </label>
      </template>
      <fieldset class="md:col-span-3 xl:col-span-6">
        <legend class="mb-2 text-12px font-700 text-ink-soft">
          请款簿组员
        </legend>
        <div class="flex flex-wrap gap-2">
          <label
            v-for="worker in eligibleMembers"
            :key="worker.id"
            class="inline-flex items-center gap-2 rounded border border-line px-2 py-1 text-12px text-ink"
          >
            <input v-model="draft.memberWorkerIds" type="checkbox" :value="worker.id">
            {{ worker.name }}
          </label>
          <span v-if="!eligibleMembers.length" class="text-11px text-ink-faint">当前范围暂无可选组员</span>
        </div>
      </fieldset>
      <label class="field md:col-span-1 xl:col-span-2">
        <span>经办人</span>
        <input v-model="draft.operatorName" aria-label="工资经办人" type="text" placeholder="用于发放快照审计">
      </label>
      <label class="field md:col-span-2 xl:col-span-4">
        <span>人工调整原因</span>
        <input v-model="draft.adjustmentReason" aria-label="工资调整原因" type="text" placeholder="如有手工调价，请填写原因">
      </label>
      <div class="md:col-span-3 xl:col-span-6 flex items-center justify-between gap-3">
        <p class="text-11px text-ink-soft">
          <template v-if="draft.formatFamily === 'B'">
            B 类必须从合同清单解析工资行；来源未接入前禁止按 A 类工程量代建。
          </template>
          <template v-else-if="draft.formatFamily === 'C2'">
            C2 以逐日签工记录为依据；签工来源未接入前禁止建单。
          </template>
          <template v-else>
            合同量只用于收支与量差对比，不会进入工资取数。
          </template>
        </p>
        <button type="submit" class="btn-primary" :disabled="draft.formatFamily === 'B' || draft.formatFamily === 'C2'">
          确认生成草稿
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.field {
  display: grid;
  min-width: 9rem;
  gap: .375rem;
  color: var(--ink-soft);
  font-size: .75rem;
  font-weight: 700;
}
.field select,
.field input {
  height: 2.25rem;
  min-width: 0;
  border: 1px solid var(--line);
  border-radius: .375rem;
  background: white;
  padding: 0 .625rem;
  color: var(--ink);
  font-size: .8125rem;
}
</style>
