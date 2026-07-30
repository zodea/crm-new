<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { yuan } from '~/lib/util/money'

const route = useRoute()
const detailStore = usePayrollStatementDetailStore()

const statementId = computed(() => String(route.params.id ?? ''))
const snapshot = computed(() => detailStore.byId(statementId.value))
const statement = computed(() => snapshot.value?.statement ?? null)
const error = shallowRef('')
const settledId = shallowRef('')
let requestVersion = 0

const statusLabel = {
  draft: '草稿',
  checked: '已核对',
  released: '已发放',
}
const sourceLabel = computed(() => statement.value?.formatFamily === 'C2'
  ? '已确认签工'
  : statement.value?.quantitySource === 'field' ? '现场复核量' : '暂估量')
const periodLabel = computed(() => statement.value?.periodKind === 'retention'
  ? '尾款 100%'
  : statement.value?.periodKind === 'settlement' ? '结算档' : '月度进度')
const shellState = computed(() => {
  if (snapshot.value)
    return 'ready'
  if (detailStore.isLoading(statementId.value) || settledId.value !== statementId.value)
    return 'loading'
  if (error.value)
    return 'error'
  return 'not-found'
})

useTabTitle(() => statement.value ? `${statement.value.leaderName}请款簿` : '请款簿详情')

async function load() {
  const id = statementId.value
  const request = ++requestVersion
  error.value = ''
  try {
    await detailStore.load(id)
  }
  catch (cause) {
    if (request === requestVersion)
      error.value = `请款簿详情加载失败：${toErrorMessage(cause)}`
  }
  finally {
    if (request === requestVersion)
      settledId.value = id
  }
}

watch(statementId, () => void load(), { immediate: true })
</script>

<template>
  <EntityDetailShell
    :title="statement ? `${statement.leaderName}请款簿` : '请款簿详情'"
    :subtitle="statement
      ? `${statement.month} · ${statement.projectName} · ${statement.crewName || '个人责任'} · ${statement.formatFamily} 族`
      : ''"
    back-to="/subcontract/payroll"
    back-label="返回工资核算"
    :state="shellState"
    :state-title="shellState === 'not-found' ? '请款簿不存在或已删除' : shellState === 'error' ? '请款簿详情加载失败' : '正在加载请款簿详情'"
    :state-description="shellState === 'not-found' ? '该工资单或其上级项目、班组、负责人已删除。' : error"
    :state-action-label="shellState === 'error' ? '重新加载' : ''"
    @state-action="load"
  >
    <template #mark>
      <div class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand">
        资
      </div>
    </template>

    <template #status>
      <span
        v-if="statement"
        class="chip"
        :class="statement.needsRecheck ? 'chip-danger' : statement.status === 'released' ? 'chip-ok' : statement.status === 'checked' ? 'chip-warn' : 'chip-brand'"
      >
        {{ statement.needsRecheck ? '需重新核对' : statusLabel[statement.status] }}
      </span>
    </template>

    <template #summary>
      <MetricGrid v-if="statement && snapshot" :cols="5">
        <Metric label="期间" :value="periodLabel" />
        <Metric label="发放比例" :value="`${Math.round(statement.payRatio * 100)}%`" />
        <Metric label="核算应发" :value="yuan(statement.grossAmount)" />
        <Metric label="正式已发" :value="yuan(snapshot.summary.formalPaidAmount)" :tone="statement.status === 'released' ? 'ok' : undefined" big />
        <Metric label="成员" :value="`${snapshot.summary.memberCount} 人`" />
      </MetricGrid>
    </template>

    <template v-if="statement && snapshot">
      <section
        v-if="statement.status === 'draft' && statement.quantitySource === 'provisional'"
        role="status"
        class="panel mb-4 border-warn-border bg-warn-soft px-4 py-3 text-12px text-warn-ink"
      >
        <strong>当前按暂估量预核</strong>
        <p class="mt-1">
          核对时必须重新读取现场复核量；未发放前不会计入正式工资。
        </p>
      </section>
      <section
        v-else-if="statement.needsRecheck"
        role="alert"
        class="panel mb-4 border-danger-border bg-danger-soft px-4 py-3 text-12px text-danger-ink"
      >
        <strong>来源已变化，需重新核对</strong>
        <p class="mt-1">
          上游现场量或考勤版本发生变化，本单暂不能发放。
        </p>
      </section>

      <section class="panel mb-4 p-4" aria-label="请款簿基本信息">
        <SectionHeader title="单据信息" :subtitle="`${sourceLabel} × ${Math.round(statement.payRatio * 100)}%`" />
        <dl class="grid gap-x-6 gap-y-3 text-12px sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt class="text-ink-faint">
              项目
            </dt><dd class="mt-1 font-700 text-ink">
              {{ statement.projectName }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              班组
            </dt><dd class="mt-1 font-700 text-ink">
              {{ statement.crewName || '个人责任' }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              负责人
            </dt><dd class="mt-1 font-700 text-ink">
              {{ statement.leaderName }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              累计核算
            </dt><dd class="mt-1 font-mono text-ink">
              {{ yuan(statement.cumulativeAmount) }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              以前已发
            </dt><dd class="mt-1 font-mono text-ink">
              {{ yuan(statement.previouslyPaid) }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              核算行合计
            </dt><dd class="mt-1 font-mono text-ink">
              {{ yuan(snapshot.summary.calculationAmount) }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              提交时间
            </dt><dd class="mt-1 text-ink">
              {{ statement.submittedAt || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              核对时间
            </dt><dd class="mt-1 text-ink">
              {{ statement.checkedAt || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-ink-faint">
              发放时间
            </dt><dd class="mt-1 text-ink">
              {{ statement.releasedAt || '—' }}
            </dd>
          </div>
        </dl>
        <p v-if="statement.sourceVersion" class="mt-3 border-t border-line pt-3 text-11px text-ink-faint">
          来源版本 {{ statement.sourceVersion }}
          <template v-if="statement.sourceUpdatedAt">
            · 更新于 {{ statement.sourceUpdatedAt }}
          </template>
          <template v-if="statement.operatorName">
            · 经办 {{ statement.operatorName }}
          </template>
        </p>
        <p v-if="statement.adjustmentReason || statement.note" class="mt-2 break-words text-12px text-ink-soft">
          {{ statement.adjustmentReason || statement.note }}
        </p>
      </section>

      <div class="grid min-w-0 gap-4">
        <PayrollStatementMembersTable :statement="statement" />
        <PayrollStatementLinesTable :statement="statement" />
        <PayrollStatementDayworkTable v-if="statement.formatFamily === 'C2'" :statement="statement" />
      </div>
    </template>
  </EntityDetailShell>
</template>
