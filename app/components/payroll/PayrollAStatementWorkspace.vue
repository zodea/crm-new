<script setup lang="ts">
import type { PayrollALine } from '~/lib/payroll/central-a-contract'
import { computed, nextTick, shallowRef } from 'vue'
import { usePayrollAStatement } from '~/composables/usePayrollAStatement'
import { createPayrollAWorkbook } from '~/lib/payroll/a-export'
import { payrollInputNumber, payrollRatioLabel } from '~/lib/payroll/a-presentation'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{ statementId: string, origin: 'real' | 'demo', returnTo: string }>()
const emit = defineEmits<{ changed: [] }>()
const kit = useKitUI()
const ui = usePayrollAStatement({ id: () => props.statementId, origin: () => props.origin, changed: () => emit('changed') })
const { matching, output, active, busy, error, writable, pending, ratio, releaseOpen, releaseRead, releaseDraft } = ui
const selectedLine = shallowRef<PayrollALine | null>(null)
const edit = computed(() => ({ path: `/subcontract/payroll/form/${encodeURIComponent(props.statementId)}`, query: { origin: props.origin, returnTo: props.returnTo } }))
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { origin: props.origin, project: matching.value?.draft.projectId || '', month: matching.value?.draft.month || '', crew: matching.value?.draft.crewId || '', leader: matching.value?.draft.leaderWorkerId || '', returnTo: props.returnTo } }))
async function exportFile() {
  const value = output.value
  if (value?.state !== 'available' || !active.value || value.statementId !== props.statementId)
    return
  try {
    await kit.exportFile(createPayrollAWorkbook(value.document))
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
  <section class="grid min-w-0 gap-4" aria-label="A工资核对与发放">
    <PayrollACommandState :pending="!!pending" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load()" />
    <template v-if="matching">
      <section class="panel grid gap-3 p-4" aria-label="A工资处理">
        <SectionHeader title="核对与实际发放" />
        <p class="text-12px leading-5 text-ink-soft">
          {{ matching.status === 'released' ? '本次工资已冻结。当前完成记录、姓名和配置的变化不会回填原工资。' : '先按当前完成责任、现场量、工资单价和此前实际已发核对，再填写实际收款。' }}
        </p>
        <p v-if="matching.needsRecheck" class="text-12px text-warn">
          本工资已保存为需重新核对，暂不能确认实发。
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <NuxtLink v-if="matching.status === 'draft' && writable" :to="edit" class="btn-secondary">
            编辑工资草稿
          </NuxtLink><NuxtLink v-if="matching.status !== 'released'" :to="config" class="btn-secondary">
            工资配置
          </NuxtLink><KitButton v-if="matching.status !== 'released'" :disabled="!writable || !matching.eligibility.canCheck" @click="ui.execute('check')">
            重新核对工资
          </KitButton><KitButton v-if="matching.status !== 'released'" variant="primary" :disabled="!writable || !matching.eligibility.canRelease" @click="ui.openRelease">
            确认实际发放
          </KitButton>
        </div>
        <div v-if="matching.status !== 'released'" class="grid max-w-lg gap-2">
          <label class="grid gap-1 text-12px">本次支付比例（%）<input :value="ratio === null ? '' : ratio * 100" type="number" min="0" max="100" step="0.01" aria-label="核对单支付比例" class="field-input min-w-0" :disabled="!writable || matching.draft.periodKind === 'retention'" @input="ratio = payrollInputNumber(($event.target as HTMLInputElement).value) === null ? null : Number(($event.target as HTMLInputElement).value) / 100"></label><p class="text-12px text-ink-faint">
            {{ payrollRatioLabel(matching.ratioDefault) }}。已保存比例不会被建议值覆盖。
          </p><KitButton class="justify-self-start" :disabled="!writable || matching.draft.periodKind === 'retention' || ratio === matching.draft.payRatio" @click="ui.execute('ratio')">
            保存本次比例（需重新核对）
          </KitButton>
        </div>
        <p v-for="reason in matching.eligibility.reasons" :key="reason" class="text-12px text-warn">
          {{ reason }}
        </p>
      </section>
      <PayrollASourceReview v-if="matching.status !== 'released'" :read="matching" :return-to="returnTo" :editable="writable" @price="selectedLine = $event" />
    </template>
    <section v-if="output" class="panel grid gap-3 p-4" aria-label="冻结工资输出">
      <SectionHeader title="冻结工资表" /><template v-if="output.state === 'available'">
        <p class="text-12px leading-5 text-ink-soft">
          只使用本次发放时完整保存的工资与成员分配，包含零金额成员。
        </p><div class="flex flex-wrap gap-2">
          <KitButton @click="print">
            打印冻结工资表
          </KitButton><KitButton variant="secondary" @click="exportFile">
            下载冻结工资表
          </KitButton>
        </div><PayrollAFrozenPrint v-if="active" :document="output.document" />
      </template><p v-for="reason in output.state === 'unavailable' ? output.reasons : []" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
    </section>
    <PayrollAReleaseDialog v-if="releaseRead" :open="releaseOpen && active" :read="releaseRead" :busy="busy" :readonly="!writable" :pending="!!pending" :error="error" :initial="releaseDraft" @change="releaseDraft = $event" @update:open="releaseOpen = $event" @submit="ui.execute('release', $event)" @recover="ui.recover" />
    <PayrollAPriceDialog v-if="selectedLine && matching" :open="!!selectedLine" :line="selectedLine" :project-id="matching.draft.projectId || ''" :month="matching.draft.month || ''" :crew-id="matching.draft.crewId || null" :leader-worker-id="matching.draft.leaderWorkerId || ''" :return-to="returnTo" @update:open="!$event && (selectedLine = null)" @saved="ui.load()" />
  </section>
</template>
