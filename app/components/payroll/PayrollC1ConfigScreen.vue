<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { usePayrollC1Config } from '~/composables/usePayrollC1Config'
import PayrollHollowConfigSection from './PayrollHollowConfigSection.vue'

const route = useRoute()
const router = useRouter()
const hollowSection = shallowRef<{ mayLeave: () => Promise<boolean> } | null>(null)
const hollowLocked = shallowRef(false)
const ui = usePayrollC1Config(() => hollowSection.value?.mayLeave() ?? true)
const { current, matching, scope, drafts, loading, error, commandError, busy, pending, writable, dirty, latest } = ui
const hollowLeader = computed(() => typeof route.query.leader === 'string' && matching.value?.options.workers.some(worker => worker.id === route.query.leader && worker.eligible) ? route.query.leader : '')
const hollowConfig = computed(() => hollowLeader.value && matching.value ? { scope: { formatFamily: 'C1' as const, projectId: matching.value.scope.projectId, crewId: matching.value.scope.crewId, leaderWorkerId: hollowLeader.value, book: null }, month: matching.value.scope.month } : null)
function lookup(rows: { id: string, name: string | null }[]) {
  return async (keyword: string) => rows.filter(row => `${row.name || ''} ${row.id}`.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase())).map(row => ({ id: row.id, label: row.name || '名称未记录' }))
}
const projects = computed(() => lookup(current.value?.options.projects || []))
const crews = computed(() => lookup(current.value?.options.crews || []))
const selectedProject = computed(() => matching.value?.options.projects.find(row => row.id === matching.value?.scope.projectId)?.name || '项目名称未记录')
const selectedCrew = computed(() => matching.value?.options.crews.find(row => row.id === matching.value?.scope.crewId)?.name || '班组名称未记录')
async function change(field: 'project' | 'month' | 'crew' | 'leader', value: string) {
  if (hollowLocked.value || !await (hollowSection.value?.mayLeave() ?? true))
    return
  void router.replace({ path: '/subcontract/payroll/config', query: { ...route.query, format: 'C1', [field]: value || undefined, ...(field === 'project' ? { crew: undefined } : {}) } })
}
useTabTitle('C1 个人工资标准')
</script>

<template>
  <EntityFormShell title="C1 个人工资标准" subtitle="按项目、工人和生效月份保存。已发工资保持冻结，未发工资须重新核对考勤。" :sections="[{ key: 'scope', label: '配置范围' }, { key: 'rates', label: '个人标准' }, { key: 'hollow-config', label: '空鼓扣款' }]" :state="!matching ? loading ? 'loading' : 'error' : 'ready'" :state-description="error" state-title="标准未能读取" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load">
    <PayrollACommandState :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="commandError || error" @recover="ui.recover" @refresh="ui.load" />
    <section id="section-scope" class="panel my-4 grid gap-4 p-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-1 text-12px">项目<LookupSelect :model-value="scope.projectId || null" :fetch="projects" placeholder="配置项目" :disabled-reason="busy || pending ? '请先完成当前提交核对' : undefined" @update:model-value="change('project', $event || '')" /><span v-if="matching && (busy || pending)" class="break-words text-ink-soft">{{ selectedProject }}</span></label>
      <label class="grid min-w-0 gap-1 text-12px">生效月份<input :value="scope.month" class="field-input min-w-0" type="month" aria-label="生效月份" :disabled="busy || !!pending || hollowLocked" @change="change('month', ($event.target as HTMLInputElement).value)"></label>
      <label class="grid min-w-0 gap-1 text-12px">班组<LookupSelect :model-value="scope.crewId || null" :fetch="crews" placeholder="配置班组" :disabled-reason="busy || pending ? '请先完成当前提交核对' : undefined" @update:model-value="change('crew', $event || '')" /><span v-if="!scope.crewId" class="text-12px text-ink-soft">全部班组</span><span v-else-if="matching && (busy || pending)" class="break-words text-ink-soft">{{ selectedCrew }}</span></label>
    </section>
    <p v-for="reason in current?.readonlyReasons || []" :key="reason" class="mb-3 text-12px text-warn">
      {{ reason }}
    </p>
    <section v-if="latest" class="panel mb-4 p-3 text-12px">
      资料已有新版本，当前填写仍保留。<KitButton class="ml-2" :disabled="busy || !!pending || hollowLocked" @click="ui.adopt">
        按当前稿重新核对标准
      </KitButton>
    </section>
    <PayrollC1RateEditor v-if="matching" id="section-rates" :rates="matching.rates" :drafts="drafts" :workers="current?.options.workers || []" :disabled="!writable || hollowLocked" @change="drafts = $event" />
    <section v-if="matching" class="panel mt-4 grid gap-2 p-4">
      <label class="grid min-w-0 gap-1 text-12px">空鼓扣款请款负责人<select class="field-input min-w-0 w-full" aria-label="空鼓扣款请款负责人" :value="hollowLeader" :disabled="busy || !!pending || hollowLocked" @change="change('leader', ($event.target as HTMLSelectElement).value)"><option value="">请选择原请款负责人</option><option v-for="worker in matching.options.workers" :key="worker.id" :value="worker.id" :disabled="!worker.eligible || hollowLocked">{{ worker.name || '姓名未记录' }}</option></select></label>
    </section>
    <PayrollHollowConfigSection v-if="matching && hollowConfig" ref="hollowSection" :config="hollowConfig" :origin="matching.context.origin" :blocked="busy || !!pending" @locked="hollowLocked = $event" />
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending || hollowLocked" @click="ui.leave">
          返回
        </KitButton><KitButton variant="primary" :disabled="!writable || !dirty || hollowLocked" @click="ui.save">
          {{ busy ? '正在保存…' : '保存个人标准' }}
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
