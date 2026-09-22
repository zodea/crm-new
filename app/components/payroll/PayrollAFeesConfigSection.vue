<script setup lang="ts">
import type { usePayrollAFeesConfig } from '~/composables/usePayrollAFeesConfig'
import type { PayrollAPeriodKind } from '~/lib/payroll/central-a-contract'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import PayrollAFeeEditor from './PayrollAFeeEditor.vue'
import PayrollAManagementBookEditor from './PayrollAManagementBookEditor.vue'

const props = defineProps<{
  ui: ReturnType<typeof usePayrollAFeesConfig>
  blocked: boolean
}>()
const emit = defineEmits<{
  book: [
        id: string | null,
  ]
}>()
const route = useRoute()
const panel = shallowRef<HTMLElement | null>(null)
let active = true
let focusRequest = 0
function sourceReturn(feeId: string) {
  const url = new URL(route.fullPath, 'https://payroll.invalid')
  url.searchParams.set('focus', feeId)
  return `${url.pathname}${url.search}`
}
const { book, current, matching, latest, rows, removed, management, pending, busy, dirty, editable, canEditFees, canEditManagement, canStart, error, errorPanel } = props.ui
const period = shallowRef<PayrollAPeriodKind>('monthly')
const fees = computed(() => [...new Map((current.value?.fees ?? []).map(fee => [fee.feeId, (current.value?.fees ?? []).filter(item => item.feeId === fee.feeId).reduce((last, item) => item.revision > last.revision ? item : last, fee)])).values()])
const selected = computed(() => current.value?.managementBooks.find(item => item.book.id === book.value?.managementBookId))
async function restoreFocus() {
  const wanted = route.query.focus
  const request = ++focusRequest
  if (!active || typeof wanted !== 'string')
    return
  await nextTick()
  if (!active || request !== focusRequest || route.query.focus !== wanted)
    return
  const row = [...panel.value?.querySelectorAll<HTMLElement>('[data-fee-input]') ?? []].find(element => element.dataset.feeInput === wanted)
  row?.scrollIntoView?.({ block: 'center', inline: 'nearest' })
  row?.focus({ preventScroll: true })
}
watch([() => route.query.focus, rows], () => void restoreFocus(), { immediate: true, flush: 'post' })
onActivated(() => {
  active = true
  void restoreFocus()
})
onDeactivated(() => {
  active = false
  focusRequest += 1
})
onScopeDispose(() => {
  active = false
  focusRequest += 1
})
</script>

<template>
  <section id="section-fees" ref="panel" class="grid grid-cols-1 min-w-0 scroll-mt-4 gap-4" aria-label="项目主体费用与管理簿">
    <PayrollACommandState ref="errorPanel" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" focusable @recover="ui.execute('recover')" @refresh="ui.load" />
    <section class="panel grid grid-cols-1 min-w-0 gap-3 p-4">
      <SectionHeader title="项目主体费用与管理簿" subtitle="逐条补贴按明确分项及范围核算；管理费使用管理人自己的请款簿。" />
      <p v-if="ui.loading.value" role="status" class="text-12px">
        正在读取费用与原责任…
      </p>
      <p v-for="reason in current?.readonlyReasons ?? []" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
      <label class="grid max-w-xl gap-1 text-12px">当前请款簿<select class="field-input min-w-0 w-full" :value="book?.managementBookId || ''" aria-label="费用请款簿" :disabled="busy || !!pending || blocked" @change="emit('book', ($event.target as HTMLSelectElement).value || null)"><option value="">普通施工工资 · 当前请款主体</option><option v-for="entry in current?.managementBooks ?? []" :key="entry.book.id" :value="entry.book.id">{{ entry.managerName || '未指定管理人' }} · {{ entry.revision?.managementMode === 'company-managed' ? '公司代管' : '独立管理费' }} · {{ entry.revision?.effectiveMonth || '修订未记录' }}</option></select></label>
      <p v-if="selected" class="text-12px leading-5">
        {{ selected.revision?.evidenceNote }}。同一人的普通工资已领与本管理簿分别核对。
      </p>
      <template v-if="matching">
        <p v-for="reason in current?.eligibility.feeReasons ?? []" :key="reason" class="text-12px text-warn">
          {{ reason }}
        </p>
        <div v-if="latest && latest.baseVersion !== matching.baseVersion && dirty" class="grid gap-2 text-12px text-warn">
          <p>配置已有新读取，原稿仍使用原依据。请核对当前记录后明确采用。</p><KitButton class="justify-self-start" type="button" variant="secondary" :disabled="!editable" @click="ui.adoptLatest">
            保留费用稿并采用当前依据
          </KitButton>
        </div>
        <KitTable :columns="[{ field: 'name', title: '费用', minWidth: 180 }, { field: 'kind', title: '类别', width: 100, slot: 'kind' }, { field: 'enabled', title: '状态', width: 100, slot: 'state' }, { field: 'unitPrice', title: '单价', minWidth: 130, slot: 'price' }, { field: 'unit', title: '单位', width: 90 }, { field: 'basis', title: '基数范围', minWidth: 220, slot: 'basis' }, { field: 'revision', title: '修订', width: 80 }, { field: 'id', title: '操作', minWidth: 120, slot: 'action' }]" :data="fees" :min-rows="2" :empty="{ title: '当前请款簿尚无费用配置', description: '未配置不会自动采用班组默认。' }">
          <template #kind="{ row }">
            {{ { housing: '房补', subsidy: '补贴', management: '管理费' }[row.kind as 'housing' | 'subsidy' | 'management'] }}
          </template>
          <template #state="{ row }">
            {{ row.removed ? '已移除' : row.enabled ? '启用' : '关闭' }}
          </template>
          <template #price="{ row }">
            {{ payrollAmount(row.unitPrice) }}
          </template>
          <template #basis="{ row }">
            <div tabindex="0" class="max-h-16 overflow-auto whitespace-normal break-words leading-5">
              {{ row.basis.itemIds.map((id: string) => current?.items.find(item => item.itemId === id)?.itemName || '原分项未能读取').join('、') || '未选分项' }} · {{ row.basis.scope.kind === 'project' ? '主体已证完成' : `${row.basis.scope.cells.length} 个明确位置` }}
            </div>
          </template>
          <template #action="{ row }">
            <KitButton v-if="!row.removed" type="button" size="sm" variant="secondary" :disabled="!canEditFees" @click="ui.editFee(row)">
              修订费用
            </KitButton>
          </template>
        </KitTable>
        <PayrollAFeeEditor v-for="row in rows" :key="row.key" :data-fee-input="row.draft.feeId || row.key" tabindex="-1" :draft="row.draft" :read="current!" :return-to="sourceReturn(row.draft.feeId || row.key)" :disabled="!canEditFees" @change="ui.changeFee(row.key, $event)" @remove="ui.removeFee(row.key)" />
        <p v-if="removed.length" class="text-12px text-warn">
          待移除 {{ removed.length }} 条费用；保存会追加明确移除修订。
        </p>
        <div class="flex flex-wrap gap-2">
          <KitButton type="button" variant="secondary" :disabled="!canEditFees || !matching.scope.leaderWorkerId" @click="ui.addFee">
            新增费用
          </KitButton><KitButton type="button" :disabled="!canEditFees || (!rows.length && !removed.length)" @click="ui.execute('fees')">
            保存费用配置
          </KitButton>
        </div>
      </template>
    </section>
    <section v-if="current" id="section-management" class="panel grid grid-cols-1 min-w-0 scroll-mt-4 gap-3 p-4" aria-label="独立管理关系">
      <SectionHeader title="独立管理关系" subtitle="只管理明确的原施工责任；公司代管范围不生成管理费单，原已发记录继续保留。" />
      <p v-for="reason in current.eligibility.managementReasons" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
      <div class="flex flex-wrap gap-2">
        <KitButton type="button" variant="secondary" :disabled="!canEditManagement || !!management" @click="ui.editManagement('crew-managed')">
          新增班组管理范围
        </KitButton><KitButton type="button" variant="secondary" :disabled="!canEditManagement || !!management" @click="ui.editManagement('company-managed')">
          新增公司代管范围
        </KitButton><KitButton v-if="selected?.revision" type="button" variant="secondary" :disabled="!canEditManagement || !!management" @click="ui.editManagement(selected)">
          修订当前管理范围
        </KitButton>
      </div>
      <PayrollAManagementBookEditor v-if="management" :draft="management" :read="current" :return-to="route.fullPath" :disabled="!canEditManagement" @change="management = $event" />
      <KitButton v-if="management" class="justify-self-start" type="button" :disabled="!canEditManagement" @click="ui.execute('management')">
        保存管理关系
      </KitButton>
      <template v-if="selected">
        <p v-for="reason in selected.reasons" :key="reason" class="text-12px text-warn">
          {{ reason }}
        </p>
        <label class="grid max-w-sm gap-1 text-12px">管理单档位<select v-model="period" class="field-input min-w-0" aria-label="管理单档位" :disabled="!editable"><option value="monthly">月度请款</option><option value="settlement">工程结算</option><option value="retention">尾款</option></select></label>
        <p v-if="selected.revision?.managementMode === 'company-managed'" class="text-12px text-ink-faint">
          当前范围为公司代管，不生成管理费单。
        </p>
        <KitButton v-else class="justify-self-start" type="button" :disabled="!canStart || dirty || blocked || !selected.eligible" @click="ui.execute('start', selected, period)">
          生成或打开本期管理费草稿
        </KitButton>
        <p v-if="dirty || blocked" class="text-12px text-ink-faint">
          请先保存当前输入，再打开管理单。
        </p>
      </template>
      <PayrollReadHistory :history="current.history" />
    </section>
  </section>
</template>
