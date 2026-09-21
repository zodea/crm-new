<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { usePayrollC2Config } from '~/composables/usePayrollC2Config'
import { c2InputNumber, c2Number, payrollC2Lookup } from '~/lib/payroll/c2-presentation'
import PayrollHollowConfigSection from './PayrollHollowConfigSection.vue'

const route = useRoute()
const router = useRouter()
const hollowSection = shallowRef<{ mayLeave: () => Promise<boolean> } | null>(null)
const hollowLocked = shallowRef(false)
const ui = usePayrollC2Config(() => hollowSection.value?.mayLeave() ?? true)
const { current, matching, scope, draft, loading, error, busy, pending, writable, dirty, latest, commandError, fieldErrors } = ui
const hollowMonth = computed(() => typeof route.query.month === 'string' && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(route.query.month) ? route.query.month : '')
const hollowConfig = computed(() => matching.value && hollowMonth.value ? { scope: { formatFamily: 'C2' as const, projectId: matching.value.scope.projectId, crewId: matching.value.config?.crewId ?? draft.value.crewId, leaderWorkerId: matching.value.scope.leaderWorkerId, book: null }, month: hollowMonth.value } : null)
const projects = computed(() => payrollC2Lookup(current.value?.options.projects || []))
const leaders = computed(() => payrollC2Lookup(current.value?.options.workers.filter(row => row.eligible) || []))
async function changeScope(field: 'project' | 'leader' | 'month', value: string) {
  if (hollowLocked.value || !await (hollowSection.value?.mayLeave() ?? true))
    return
  if (!busy.value && !pending.value)
    void router.replace({ path: '/subcontract/payroll/config', query: { ...route.query, format: 'C2', [field]: value || undefined, ...(field === 'project' ? { leader: undefined } : {}) } })
}
useTabTitle('C2 主体配置')
</script>

<template>
  <EntityFormShell title="C2 主体配置" subtitle="按项目与请款负责人保存大工单价及原规则；未发工资需重新核对，已发快照保持不变。" :sections="[{ key: 'scope', label: '请款主体' }, { key: 'config', label: '单价与规则' }, { key: 'hollow-config', label: '空鼓扣款' }]" :state="!matching ? loading ? 'loading' : 'error' : 'ready'" state-title="配置未能读取" :state-description="error" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load">
    <PayrollACommandState :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="commandError || error" @recover="ui.recover" @refresh="ui.load" />
    <section id="section-scope" class="panel my-4 grid min-w-0 gap-4 p-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-1 text-12px">项目<LookupSelect :model-value="scope.projectId || null" :fetch="projects" placeholder="C2 配置项目" :disabled-reason="busy || pending ? '请先核对原提交' : undefined" @update:model-value="changeScope('project', $event || '')" /><span v-if="busy || pending">{{ matching?.options.projects.find(row => row.id === scope.projectId)?.name || '未选择项目' }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">请款负责人<LookupSelect :model-value="scope.leaderWorkerId || null" :fetch="leaders" placeholder="C2 配置负责人" :disabled-reason="busy || pending ? '请先核对原提交' : undefined" @update:model-value="changeScope('leader', $event || '')" /><span v-if="busy || pending">{{ matching?.options.workers.find(row => row.id === scope.leaderWorkerId)?.name || '未选择负责人' }}</span></label>
      <p class="text-12px">
        所属班组：{{ draft.crewId ? matching?.options.crews.find(row => row.id === draft.crewId)?.name || '班组名称未记录' : scope.leaderWorkerId ? '负责人实际无班组' : '选择负责人后确定' }}
      </p>
    </section>
    <p v-for="reason in current?.readonlyReasons || []" :key="reason" class="mb-3 text-12px text-warn">
      {{ reason }}
    </p>
    <section v-if="latest" class="panel mb-4 p-3 text-12px">
      来源已有新版本，原配置输入仍保留。<KitButton class="ml-2" :disabled="busy || !!pending || hollowLocked" @click="ui.adopt">
        按当前稿重新核对配置
      </KitButton>
    </section>
    <section v-if="matching" id="section-config" class="panel grid min-w-0 gap-4 p-4">
      <SectionHeader title="大工单价与确认规则" /><p v-if="matching.config" class="text-12px text-ink-soft">
        原配置：{{ c2Number(matching.config.unitRate) }} 元/工 · {{ matching.config.enabled ? '有效' : '当前停用或状态未记录' }}
      </p><label class="grid min-w-0 gap-1 text-12px">大工单价（元/工）<input :value="draft.unitRate ?? ''" type="number" step="any" class="field-input min-w-0" aria-label="大工单价" data-field="unitRate" :disabled="!writable || hollowLocked" @input="ui.change({ unitRate: c2InputNumber(($event.target as HTMLInputElement).value) })"><span class="text-danger">{{ fieldErrors.unitRate }}</span></label><label class="grid min-w-0 gap-1 text-12px">确认规则<textarea :value="draft.ruleText ?? ''" rows="5" class="field-input min-w-0" aria-label="确认规则" data-field="ruleText" :disabled="!writable || hollowLocked" @input="ui.change({ ruleText: ($event.target as HTMLTextAreaElement).value })" /><span v-if="draft.ruleText === null" class="text-warn">原规则未记录；请明确填写，或确认保存空规则。</span><span class="text-danger">{{ fieldErrors.ruleText }}</span></label><KitButton v-if="draft.ruleText === null" :disabled="!writable || hollowLocked" @click="ui.change({ ruleText: '' })">
        明确保存空规则
      </KitButton><p class="text-12px leading-5 text-ink-soft">
        规则文字随工资发放冻结，不自动执行逾期免费、双扣或其他罚扣。
      </p>
    </section>
    <PayrollSourceEvidence v-if="matching" class="mt-4" :evidence="matching.evidence" />
    <section v-if="matching" class="panel mt-4 grid gap-2 p-4">
      <label class="grid min-w-0 gap-1 text-12px">空鼓核对月份<input class="field-input min-w-0 w-full" type="month" aria-label="空鼓核对月份" :value="hollowMonth" :disabled="busy || !!pending || hollowLocked" @input="changeScope('month', ($event.target as HTMLInputElement).value)"></label>
    </section>
    <PayrollHollowConfigSection v-if="matching && hollowConfig" ref="hollowSection" :config="hollowConfig" :origin="matching.context.origin" :blocked="busy || !!pending" @locked="hollowLocked = $event" />
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending || hollowLocked" @click="ui.leave">
          返回
        </KitButton><KitButton variant="primary" :disabled="!writable || !dirty || hollowLocked" @click="ui.save">
          保存主体配置
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
