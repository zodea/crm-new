<script setup lang="ts">
import type { RouteLocationRaw } from 'vue-router'
import type { usePayrollC1Statement } from '~/composables/usePayrollC1Statement'
import type { usePayrollC2Statement } from '~/composables/usePayrollC2Statement'
import type { ExportFileOptions } from '~/lib/kit/export'
import { computed, nextTick, shallowRef } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import { toErrorMessage } from '~/lib/util/error'
import PayrollACommandState from './PayrollACommandState.vue'
import PayrollHollowReview from './PayrollHollowReview.vue'
import PayrollReleaseAdjustmentSelection from './PayrollReleaseAdjustmentSelection.vue'
import PayrollTierReleaseDialog from './PayrollTierReleaseDialog.vue'

type StatementWorkspace = ReturnType<typeof usePayrollC1Statement> | ReturnType<typeof usePayrollC2Statement>

const props = defineProps<{
  tier: 'C1' | 'C2'
  statementId: string
  origin: 'real' | 'demo'
  returnTo: string
  ui: StatementWorkspace
  config: RouteLocationRaw
  createWorkbook: () => ExportFileOptions | null
}>()
defineSlots<{ source: () => unknown, print: () => unknown }>()

const adjustmentsReady = shallowRef(false)
const hollowLocked = shallowRef(false)
const kit = useKitUI()
const { matching, output, active, busy, error, writable, pending, releaseOpen, releaseRead, releaseDraft } = props.ui
const source = computed(() => props.tier === 'C1' ? '考勤' : '签工')
const statusMessage = computed(() => {
  if (matching.value?.status !== 'released') {
    return props.tier === 'C1'
      ? '先核对本月逐日考勤与每人有效标准，再按真实收款确认。核对后仍可依法修正未发考勤，但必须重新核对工资。'
      : '先核对本月已确认签工与主体单价，再按真实收款确认。核对后仍可按规则修改未发签工，但必须重新核对工资。'
  }
  if (output.value?.state === 'available')
    return `本次工资与${source.value}已冻结，原全成员整月锁定。`
  if (output.value?.state === 'unavailable')
    return '原记录标为已发放，本页只读；逐日来源或发放证据不完整，不能生成配对输出。'
  return '原记录标为已发放，本页只读；配对输出须先核实逐日来源与发放证据。'
})
const edit = computed(() => ({ path: `/subcontract/payroll/form/${encodeURIComponent(props.statementId)}`, query: { origin: props.origin, format: props.tier, returnTo: props.returnTo } }))

async function exportFile() {
  const value = output.value
  if (value?.state !== 'available' || !active.value)
    return
  try {
    const workbook = props.createWorkbook()
    if (workbook)
      await kit.exportFile(workbook)
  }
  catch (cause) {
    if (value === output.value && active.value)
      error.value = toErrorMessage(cause)
  }
}

async function print() {
  const value = output.value
  if (value?.state !== 'available')
    return
  await nextTick()
  if (active.value && value === output.value && value.statementId === props.statementId)
    window.print()
}
</script>

<template>
  <PayrollACommandState :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load()" />
  <template v-if="matching">
    <PayrollHollowReview v-if="matching.hollow" :read="matching.hollow" :return-to="returnTo" :readonly="matching.status === 'released'" :blocked="busy || !!pending || releaseOpen" @changed="ui.load()" @locked="hollowLocked = $event" />
    <section class="panel grid gap-3 p-4">
      <SectionHeader :title="`核对${source}与实际发放`" />
      <p class="text-12px leading-5 text-ink-soft">
        {{ statusMessage }}
      </p>
      <p v-if="matching.status !== 'released' && matching.needsRecheck" class="text-12px text-warn">
        资料已变化，本工资需要重新核对{{ source }}。
      </p>
      <div class="flex flex-wrap gap-2">
        <NuxtLink v-if="matching.status === 'draft' && writable" :to="edit" class="btn-secondary">
          编辑 {{ tier }} 草稿
        </NuxtLink>
        <NuxtLink v-if="matching.status !== 'released'" :to="config" class="btn-secondary">
          {{ tier === 'C1' ? '个人工资标准' : 'C2 主体配置' }}
        </NuxtLink>
        <KitButton v-if="matching.status !== 'released'" :disabled="!writable || !matching.eligibility.canCheck || hollowLocked" @click="ui.execute('check')">
          {{ matching.status === 'draft' ? '核对' : '重新核对' }}{{ source }}
        </KitButton>
        <KitButton v-if="matching.status !== 'released'" variant="primary" :disabled="!writable || !matching.eligibility.canRelease || !adjustmentsReady || hollowLocked" @click="ui.openRelease">
          确认实际发放
        </KitButton>
      </div>
      <template v-if="matching.status !== 'released'">
        <p v-for="reason in matching.eligibility.reasons" :key="reason" class="text-12px text-warn">
          {{ reason }}
        </p>
      </template>
    </section>
    <slot v-if="matching.status !== 'released'" name="source" />
  </template>
  <PayrollReleaseAdjustmentSelection v-if="matching && matching.status !== 'released'" :statement-id="statementId" :origin="origin" :source-version="matching.context.sourceVersion" :return-to="returnTo" :applications="releaseDraft?.adjustmentApplications" :disabled="!writable || releaseOpen || hollowLocked" @change="ui.setReleaseApplications" @valid="adjustmentsReady = $event" />
  <section v-if="output" class="panel grid gap-3 p-4" :aria-label="`冻结工资与${source}输出`">
    <SectionHeader :title="`冻结工资与${source}表`" />
    <template v-if="output.state === 'available'">
      <p class="text-12px">
        两份表来自同一次真实发放，包含零收款成员与原逐日{{ source }}。
      </p>
      <div class="flex flex-wrap gap-2">
        <KitButton @click="print">
          打印工资与{{ source }}表
        </KitButton>
        <KitButton variant="secondary" @click="exportFile">
          下载工资与{{ source }}表
        </KitButton>
      </div>
      <slot v-if="active" name="print" />
    </template>
    <p v-for="reason in output.state === 'unavailable' ? output.reasons : []" :key="reason" class="text-12px text-warn">
      {{ reason }}
    </p>
  </section>
  <PayrollTierReleaseDialog v-if="releaseRead" :open="releaseOpen && active" :read="releaseRead" :busy="busy" :readonly="!writable || !adjustmentsReady" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :error="error" :initial="releaseDraft" @change="releaseDraft = $event" @update:open="releaseOpen = $event" @submit="ui.execute('release', $event)" @recover="ui.recover" />
</template>
