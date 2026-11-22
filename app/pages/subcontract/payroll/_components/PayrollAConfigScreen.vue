<script setup lang="ts">
import type { PayrollAPriceRevision } from '~/lib/payroll/central-a-contract'
import { computed, shallowRef } from 'vue'
import PayrollACommandState from '~/components/payroll/PayrollACommandState.vue'
import PayrollAPriceEditor from '~/components/payroll/PayrollAPriceEditor.vue'
import PayrollReadHistory from '~/components/payroll/PayrollReadHistory.vue'
import { usePayrollAConfig } from '~/composables/usePayrollAConfig'
import { payrollInputNumber } from '~/lib/payroll/a-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import PayrollAFeesConfigSection from '~/pages/subcontract/payroll/_components/PayrollAFeesConfigSection.vue'
import PayrollARoundingSection from '~/pages/subcontract/payroll/_components/PayrollARoundingSection.vue'
import PayrollHollowConfigSection from './PayrollHollowConfigSection.vue'

const hollowSection = shallowRef<{ mayLeave: () => Promise<boolean> } | null>(null)
const hollowLocked = shallowRef(false)
const roundingLocked = shallowRef(false)
const configLocked = computed(() => hollowLocked.value || roundingLocked.value)
const ui = usePayrollAConfig(() => roundingLocked.value ? false : hollowSection.value?.mayLeave() ?? true)
const { scope, projects, matching, subject, prices, subjectRead, priceRead, busy, loading, error, pending, editable, subjectDirty, priceDirty } = ui
const hollowConfig = computed(() => scope.value.leaderWorkerId && ui.fees.book.value ? { scope: { formatFamily: 'A' as const, projectId: scope.value.projectId, crewId: scope.value.crewId, leaderWorkerId: scope.value.leaderWorkerId, book: ui.fees.book.value }, month: scope.value.month } : null)
const roundingScope = computed(() => scope.value.projectId && scope.value.month && scope.value.leaderWorkerId && ui.fees.book.value ? { projectId: scope.value.projectId, leaderWorkerId: scope.value.leaderWorkerId, book: ui.fees.book.value, month: scope.value.month } : null)
function add() {
  if (editable.value)
    prices.value.push({ priceId: null, itemId: '', unit: null, mode: 'baseline', workerId: null, effectiveMonth: scope.value.month, unitPrice: null, scope: { kind: 'project' } })
}
function edit(value: PayrollAPriceRevision) {
  if (editable.value && value.editable && !prices.value.some(price => price.priceId === value.priceId))
    prices.value.push({ priceId: value.priceId, itemId: value.itemId, unit: value.unit, mode: value.mode, workerId: value.workerId, effectiveMonth: scope.value.month, unitPrice: value.unitPrice, scope: value.scope })
}
useTabTitle('A 工资配置')
</script>

<template>
  <EntityFormShell title="A 工资配置" subtitle="项目主体的比例、工资单价与费用分别保存；管理费使用独立请款簿。" back-label="返回原工资" :sections="[{ key: 'scope', label: '配置范围' }, { key: 'subject', label: '首月比例' }, { key: 'prices', label: '工资单价' }, { key: 'fees', label: '补贴与费用' }, { key: 'management', label: '管理关系' }, { key: 'rounding', label: '发放取整' }, { key: 'hollow-config', label: '空鼓扣款' }]" @back="ui.leave">
    <PayrollACommandState :pending="!!pending" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load" />
    <section id="section-scope" class="panel my-4 min-w-0 scroll-mt-4 p-4" aria-label="工资配置范围">
      <SectionHeader title="配置范围" /><div class="mt-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label class="grid min-w-0 gap-1 text-12px">项目<select :value="scope.projectId" class="field-input min-w-0 w-full" aria-label="配置项目" :disabled="busy || !!pending || !!ui.fees.pending.value || configLocked" @change="ui.changeScope({ projectId: ($event.target as HTMLSelectElement).value, crewId: null, leaderWorkerId: null })"><option value="">请选择项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name || '项目名称未记录' }}</option></select></label>
        <label class="grid min-w-0 gap-1 text-12px">核对月份<input :value="scope.month" type="month" class="field-input min-w-0 w-full" aria-label="配置核对月份" :disabled="busy || !!pending || !!ui.fees.pending.value || configLocked" @input="ui.changeScope({ month: ($event.target as HTMLInputElement).value })"></label>
        <label class="grid min-w-0 gap-1 text-12px">班组<select :value="scope.crewId || ''" class="field-input min-w-0 w-full" aria-label="配置班组" :disabled="busy || !!pending || !!ui.fees.pending.value || configLocked" @change="ui.changeScope({ crewId: ($event.target as HTMLSelectElement).value || null, leaderWorkerId: null })"><option value="">未关联班组</option><option v-for="crew in matching?.options.crews || []" :key="crew.id" :value="crew.id" :disabled="!crew.eligible || configLocked">{{ crew.name || '班组名称未记录' }}</option></select></label>
        <label class="grid min-w-0 gap-1 text-12px">负责人<select :value="scope.leaderWorkerId || ''" class="field-input min-w-0 w-full" aria-label="配置负责人" :disabled="busy || !!pending || !!ui.fees.pending.value || configLocked" @change="ui.changeScope({ leaderWorkerId: ($event.target as HTMLSelectElement).value || null })"><option value="">请选择负责人</option><option v-for="worker in matching?.options.workers || []" :key="worker.id" :value="worker.id" :disabled="!worker.eligible || configLocked">{{ worker.name || '姓名未记录' }}</option></select></label>
      </div>
    </section>
    <p v-if="loading" role="status" class="text-12px">
      正在核对配置范围…
    </p><p v-else-if="!matching && !error" class="panel p-4 text-12px">
      请选择项目与月份，再读取负责人和已保存工资配置。
    </p>
    <template v-if="matching">
      <p v-for="reason in matching.readonlyReasons" :key="reason" class="mb-3 text-12px leading-5 text-warn">
        {{ reason }}
      </p>
      <section v-if="ui.fees.book.value?.bookPurpose !== 'management'" id="section-subject" class="panel mb-4 grid min-w-0 grid-cols-1 scroll-mt-4 gap-3 p-4" aria-label="负责人首月比例">
        <SectionHeader title="负责人首月比例" subtitle="月度沿用上月有效月度单据保存的比例；无上月单据时使用明确首月配置，不追改已发记录。" />
        <label class="grid max-w-sm gap-1 text-12px">首月支付比例（%）<input :value="subject.initialPayRatio === null ? '' : subject.initialPayRatio * 100" type="number" min="0" max="100" step="0.01" class="field-input min-w-0" aria-label="首月支付比例" :disabled="!editable || !scope.leaderWorkerId || configLocked" @input="subject.initialPayRatio = payrollInputNumber(($event.target as HTMLInputElement).value) === null ? null : Number(($event.target as HTMLInputElement).value) / 100"></label>
        <p v-if="matching.crewRatio?.explicitlyConfigured" class="text-12px text-ink-soft">
          班组明确比例：{{ matching.crewRatio.value === null ? '尚未填写' : `${matching.crewRatio.value * 100}%` }}，不会代替当前未保存输入。
        </p>
        <div v-if="subjectRead && subjectRead.context.sourceVersion !== matching.context.sourceVersion && subjectDirty" class="text-12px text-warn">
          <p>其他配置已变化，本区保留原依据；保存时将重新验证。</p><KitButton type="button" variant="secondary" :disabled="!editable || configLocked" @click="ui.recheck('subject')">
            按当前首月比例稿重新核对
          </KitButton>
        </div>
        <KitButton class="justify-self-start" type="button" :disabled="!editable || !subjectDirty || !scope.leaderWorkerId || configLocked" @click="ui.save('subject')">
          保存首月比例
        </KitButton>
      </section>
      <section v-if="ui.fees.book.value?.bookPurpose !== 'management'" id="section-prices" class="panel grid min-w-0 grid-cols-1 scroll-mt-4 gap-3 p-4" aria-label="工资基准价与个人例外">
        <SectionHeader title="工资基准价与个人例外" subtitle="统一改对应当前负责人的分项基准；单独改保留该工人的独立调价记录。" />
        <KitTable :columns="[{ field: 'itemName', title: '分项', minWidth: 170 }, { field: 'unit', title: '单位', width: 85 }, { field: 'mode', title: '适用人员', minWidth: 170, slot: 'mode' }, { field: 'effectiveMonth', title: '生效月份', width: 115 }, { field: 'unitPrice', title: '工资单价', width: 140, slot: 'price' }, { field: 'revision', title: '修订', width: 90 }, { field: 'editable', title: '操作', minWidth: 180, slot: 'action' }]" :data="matching.prices" :min-rows="3" :row-height="52" :empty="{ title: '当前负责人尚未配置工资单价' }">
          <template #mode="{ row }">
            {{ row.mode === 'baseline' ? '负责人分项基准' : `${row.workerName || '姓名未记录'} · 调` }}
          </template><template #price="{ row }">
            {{ payrollAmount(row.unitPrice) }}
          </template><template #action="{ row }">
            <KitButton v-if="row.editable" size="sm" type="button" :disabled="!editable || configLocked" @click="edit(row)">
              修订单价
            </KitButton><span v-else class="text-11px text-ink-faint">{{ row.readonlyReasons.join('；') || '历史版本只读' }}</span>
          </template>
        </KitTable>
        <PayrollAPriceEditor v-for="(price, index) in prices" :key="price.priceId || `new-${index}`" :draft="price" :read="priceRead || matching" :disabled="!editable || configLocked" @patch="patch => prices[index] = { ...price, ...patch }" @remove="prices = prices.filter((_, itemIndex) => itemIndex !== index)" />
        <div v-if="priceRead && priceRead.context.sourceVersion !== matching.context.sourceVersion && priceDirty" class="text-12px text-warn">
          <p>首月配置已变化，本区保留原单价稿与依据；请重新核对后保存。</p><KitButton type="button" variant="secondary" :disabled="!editable || configLocked" @click="ui.recheck('prices')">
            按当前单价稿重新核对
          </KitButton>
        </div>
        <div class="flex flex-wrap gap-2">
          <KitButton type="button" variant="secondary" :disabled="!editable || !scope.leaderWorkerId || configLocked" @click="add">
            新增工资单价
          </KitButton><KitButton type="button" :disabled="!editable || !priceDirty || !scope.leaderWorkerId || configLocked" @click="ui.save('prices')">
            保存工资单价
          </KitButton>
        </div>
      </section>
      <PayrollReadHistory class="mt-4" :history="matching.history" />
    </template>
    <PayrollAFeesConfigSection class="mt-4" :ui="ui.fees" :blocked="subjectDirty || priceDirty || !!pending || configLocked" @book="ui.chooseBook" />
    <PayrollARoundingSection :scope="roundingScope" :origin="matching?.context.origin || 'real'" :blocked="busy || !!pending || !!ui.fees.pending.value || hollowLocked" @locked="roundingLocked = $event" />
    <PayrollHollowConfigSection v-if="matching && hollowConfig" ref="hollowSection" :config="hollowConfig" :origin="matching.context.origin" :blocked="busy || !!pending || roundingLocked" @locked="hollowLocked = $event" />
    <template #footer>
      <KitButton variant="secondary" :disabled="busy || !!pending || !!ui.fees.pending.value || configLocked" @click="ui.leave">
        返回原工资
      </KitButton>
    </template>
  </EntityFormShell>
</template>
