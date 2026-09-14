<script setup lang="ts">
import { computed, nextTick } from 'vue'
import { usePayrollC2Statement } from '~/composables/usePayrollC2Statement'
import { createPayrollC2Workbook } from '~/lib/payroll/c2-export'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  statementId: string
  origin: 'real' | 'demo'
  returnTo: string
}>()
const emit = defineEmits<{
  changed: [
  ]
}>()
const kit = useKitUI()
const ui = usePayrollC2Statement({ id: () => props.statementId, origin: () => props.origin, changed: () => emit('changed') })
const { matching, output, active, busy, error, writable, pending, releaseOpen, releaseRead, releaseDraft } = ui
const statusMessage = computed(() => {
  if (matching.value?.status !== 'released')
    return '先核对本月已确认签工与主体单价，再按真实收款确认。核对后仍可按规则修改未发签工，但必须重新核对工资。'
  if (output.value?.state === 'available')
    return '本次工资与签工已冻结，原全成员整月锁定。'
  if (output.value?.state === 'unavailable')
    return '原记录标为已发放，本页只读；逐日来源或发放证据不完整，不能生成配对输出。'
  return '原记录标为已发放，本页只读；配对输出须先核实逐日来源与发放证据。'
})
const edit = computed(() => ({ path: `/subcontract/payroll/form/${encodeURIComponent(props.statementId)}`, query: { origin: props.origin, format: 'C2', returnTo: props.returnTo } }))
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { origin: props.origin, format: 'C2', project: matching.value?.draft.projectId || '', leader: matching.value?.draft.leaderWorkerId || '', month: matching.value?.draft.month || '', crew: matching.value?.draft.crewId || '', returnTo: props.returnTo } }))
async function exportFile() {
  const value = output.value
  if (value?.state !== 'available' || !active.value)
    return
  try {
    await kit.exportFile(createPayrollC2Workbook(value.document))
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
  <section class="grid min-w-0 gap-4" aria-label="C2工资核对与发放">
    <PayrollACommandState :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load()" />
    <template v-if="matching">
      <section class="panel grid gap-3 p-4">
        <SectionHeader title="核对签工与实际发放" /><p class="text-12px leading-5 text-ink-soft">
          {{ statusMessage }}
        </p><p v-if="matching.status !== 'released' && matching.needsRecheck" class="text-12px text-warn">
          资料已变化，本工资需要重新核对签工。
        </p><div class="flex flex-wrap gap-2">
          <NuxtLink v-if="matching.status === 'draft' && writable" :to="edit" class="btn-secondary">
            编辑 C2 草稿
          </NuxtLink><NuxtLink v-if="matching.status !== 'released'" :to="config" class="btn-secondary">
            C2 主体配置
          </NuxtLink><KitButton v-if="matching.status !== 'released'" :disabled="!writable || !matching.eligibility.canCheck" @click="ui.execute('check')">
            {{ matching.status === 'draft' ? '核对签工' : '重新核对签工' }}
          </KitButton><KitButton v-if="matching.status !== 'released'" variant="primary" :disabled="!writable || !matching.eligibility.canRelease" @click="ui.openRelease">
            确认实际发放
          </KitButton>
        </div><template v-if="matching.status !== 'released'">
          <p v-for="reason in matching.eligibility.reasons" :key="reason" class="text-12px text-warn">
            {{ reason }}
          </p>
        </template>
      </section><PayrollC2SourceReview v-if="matching.status !== 'released'" :read="matching" :return-to="returnTo" />
    </template>
    <section v-if="output" class="panel grid gap-3 p-4" aria-label="冻结工资与签工输出">
      <SectionHeader title="冻结工资与签工表" /><template v-if="output.state === 'available'">
        <p class="text-12px">
          两份表来自同一次真实发放，包含零收款成员与原逐日签工。
        </p><div class="flex flex-wrap gap-2">
          <KitButton @click="print">
            打印工资与签工表
          </KitButton><KitButton variant="secondary" @click="exportFile">
            下载工资与签工表
          </KitButton>
        </div><PayrollC2FrozenPrint v-if="active" :document="output.document" />
      </template><p v-for="reason in output.state === 'unavailable' ? output.reasons : []" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
    </section>
    <PayrollC2ReleaseDialog v-if="releaseRead" :open="releaseOpen && active" :read="releaseRead" :busy="busy" :readonly="!writable" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :error="error" :initial="releaseDraft" @change="releaseDraft = $event" @update:open="releaseOpen = $event" @submit="ui.execute('release', $event)" @recover="ui.recover" />
  </section>
</template>
