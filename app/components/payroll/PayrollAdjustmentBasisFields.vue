<script setup lang="ts">
import type { PayrollAdjustmentBasisDraft, PayrollOriginalWageRef } from '~/lib/payroll/central-adjustment-contract'
import { computed } from 'vue'
import { c2InputNumber } from '~/lib/payroll/c2-presentation'
import { isPayrollAStatementSourceVersioned } from '~/lib/payroll/central-a-fees-validation'
import { payrollAmount } from '~/lib/payroll/read-presentation'
import PayrollAFeeAdjustmentFields from './PayrollAFeeAdjustmentFields.vue'
import PayrollHollowAdjustmentFields from './PayrollHollowAdjustmentFields.vue'

const props = defineProps<{ basis: PayrollAdjustmentBasisDraft | null, original: PayrollOriginalWageRef, disabled: boolean, sectionId?: string }>()
const emit = defineEmits<{ change: [value: PayrollAdjustmentBasisDraft] }>()
const names = computed(() => new Map(props.original.members.map(member => [member.workerId, member.workerName || '姓名未记录'])))
const aRows = computed(() => {
  const basis = props.basis
  if (basis?.formatFamily !== 'A')
    return []
  return basis.components.map((row) => {
    const facts = basis.source.facts.filter(fact => fact.ownershipKey === row.ownershipKey)
    const prices = basis.source.priceRevisions.filter(price => price.id === row.priceRevisionId)
    const fact = facts.length === 1 ? facts[0]! : null
    const price = prices.length === 1 ? prices[0]! : null
    return { row, fact, price, sourceReady: !!fact && !!price, location: fact ? [fact.buildingName || '楼栋未记录', fact.floorName || '楼层未记录', fact.unitName || '户名未记录', fact.roomName || '房间未记录'].join(' / ') : facts.length ? '原责任位置依据不唯一' : '原责任位置依据缺失', priceReason: prices.length ? '原价格依据不唯一' : '原价格依据缺失' }
  })
})
const feeSource = computed(() => {
  const source = props.basis?.formatFamily === 'A' ? props.basis.source : null
  return isPayrollAStatementSourceVersioned(source) && source.schemaVersion !== 1 ? source.fees : null
})
function update(group: 'records' | 'rates' | 'components', index: number, field: string, value: unknown) {
  if (props.disabled || !props.basis || (group === 'components' && !aRows.value[index]?.sourceReady))
    return
  const basis = JSON.parse(JSON.stringify(props.basis)) as PayrollAdjustmentBasisDraft
  if (group === 'components' && basis.formatFamily === 'A')
    Object.assign(basis.components[index]!, { [field]: value })
  else if (group === 'rates' && basis.formatFamily === 'C1')
    Object.assign(basis.rates[index]!, { [field]: value })
  else if (group === 'records' && basis.formatFamily !== 'A')
    Object.assign(basis.records[index]!, { [field]: value })
  emit('change', basis)
}
function amount(event: Event) {
  return c2InputNumber((event.target as HTMLInputElement).value)
}
function updateRatio(kind: 'item' | 'fee' | 'negative', id: string, event: Event) {
  const basis = props.basis
  if (props.disabled || basis?.formatFamily !== 'A' || !basis.ratioPlan)
    return
  const value = amount(event)
  const ratioPlan = JSON.parse(JSON.stringify(basis.ratioPlan)) as typeof basis.ratioPlan
  if (kind === 'item') {
    const entry = ratioPlan.itemRatios.find(row => row.itemId === id)
    if (entry)
      entry.ratio = value === null ? null : value / 100
  }
  else {
    ratioPlan.feeRatios = ratioPlan.feeRatios.filter(row => row.kind !== kind || row.id !== id)
    if (value !== null)
      ratioPlan.feeRatios.push({ kind, id, ratio: value / 100 })
  }
  emit('change', { ...basis, ratioPlan })
}
</script>

<template>
  <section :id="sectionId" class="panel grid min-w-0 gap-3 p-4" :aria-label="disabled ? '只读更正依据' : '独立更正依据'">
    <SectionHeader title="独立更正依据" />
    <p v-if="!basis" class="text-12px text-warn">
      原核算依据不完整，不能补造更正来源。
    </p>
    <template v-else-if="basis.formatFamily === 'A'">
      <label class="grid max-w-md gap-1 text-12px">{{ basis.ratioPlan ? '费用默认比例' : '本次更正采用比例' }}（0 至 1）<input :value="basis.payRatio ?? ''" type="number" min="0" max="1" step="any" class="field-input" :disabled="disabled || basis.periodKind === 'retention'" @input="emit('change', { ...basis, payRatio: amount($event) })"></label>
      <div v-if="basis.ratioPlan" class="grid gap-3 sm:grid-cols-2">
        <label v-for="row in basis.ratioPlan.itemRatios" :key="row.itemId" class="grid gap-1 text-12px">{{ basis.source.facts.find(fact => fact.itemId === row.itemId)?.itemName || '原分项' }}更正比例（%）<input :value="row.ratio === null ? '' : row.ratio * 100" type="number" min="0" max="100" step="0.01" class="field-input" :disabled="disabled || basis.periodKind === 'retention'" @input="updateRatio('item', row.itemId, $event)"></label>
        <label v-for="row in [...new Map((basis.fees?.components ?? []).map(component => [component.feeId, component])).values()]" :key="row.feeId" class="grid gap-1 text-12px">{{ feeSource?.lines.find(line => line.feeId === row.feeId)?.name || '原费用' }}单独比例（%，留空使用默认比例）<input :value="basis.ratioPlan.feeRatios.find(entry => entry.kind === 'fee' && entry.id === row.feeId)?.ratio == null ? '' : basis.ratioPlan.feeRatios.find(entry => entry.kind === 'fee' && entry.id === row.feeId)!.ratio * 100" type="number" min="0" max="100" step="0.01" class="field-input" :disabled="disabled || basis.periodKind === 'retention'" @input="updateRatio('fee', row.feeId, $event)"></label>
        <label v-for="row in basis.fees?.negativeLines ?? []" :key="row.lineId" class="grid gap-1 text-12px">{{ row.label }}单独比例（%，留空使用默认比例）<input :value="basis.ratioPlan.feeRatios.find(entry => entry.kind === 'negative' && entry.id === row.lineId)?.ratio == null ? '' : basis.ratioPlan.feeRatios.find(entry => entry.kind === 'negative' && entry.id === row.lineId)!.ratio * 100" type="number" min="0" max="100" step="0.01" class="field-input" :disabled="disabled || basis.periodKind === 'retention'" @input="updateRatio('negative', row.lineId, $event)"></label>
      </div>
      <div v-if="basis.components.length" tabindex="0" aria-label="A 原责任量价更正表" class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-640px text-left text-12px">
          <thead>
            <tr class="border-b border-line">
              <th class="p-2">
                原责任范围
              </th><th class="p-2">
                更正现场量
              </th><th class="p-2">
                更正单价
              </th><th class="p-2">
                原价格依据
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="({ row, fact, price, sourceReady, location, priceReason }, index) in aRows" :key="row.ownershipKey" class="border-b border-line">
              <td class="min-w-48 max-w-64 break-words p-2 leading-5">
                {{ location }}<template v-if="fact">
                  <span class="block font-600">{{ fact.itemName || '分项未记录' }} · {{ fact.unit || '单位未记录' }}</span><span class="block text-ink-soft">原施工：{{ fact.workerName || fact.crewName || '责任名称未记录' }}</span>
                </template>
              </td><td class="p-2">
                <input :value="row.quantity ?? ''" :aria-label="`第${index + 1}项更正现场量`" type="number" min="0" step="any" class="field-input w-32" :disabled="disabled || !sourceReady" @input="update('components', index, 'quantity', amount($event))">
              </td><td class="p-2">
                <input :value="row.unitPrice ?? ''" :aria-label="`第${index + 1}项更正单价`" type="number" step="0.01" class="field-input w-32" :disabled="disabled || !sourceReady" @input="update('components', index, 'unitPrice', amount($event))">
              </td><td class="min-w-40 max-w-48 break-words p-2 leading-5">
                <template v-if="price">
                  <span class="block">{{ price.mode === 'baseline' ? '基准单价' : '个人例外单价' }} · 修订 {{ price.revision }}</span><span class="block whitespace-nowrap font-mono">{{ payrollAmount(price.unitPrice) }} / {{ price.unit || '单位未记录' }}</span><span class="block text-ink-soft">{{ price.effectiveMonth }} 起生效</span>
                </template><span v-else class="text-warn">{{ priceReason }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <PayrollAFeeAdjustmentFields v-if="feeSource && basis.fees" :basis="basis.fees" :source="feeSource" :disabled="disabled" @change="emit('change', { ...basis, fees: $event })" />
      <p v-else-if="basis.fees" class="text-12px text-warn">
        原费用版本与完整来源未通过核对，不能补造费用更正。
      </p>
    </template>
    <template v-else-if="basis.formatFamily === 'C1'">
      <div tabindex="0" aria-label="原成员更正标准" class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-600px text-left text-12px">
          <thead>
            <tr class="border-b border-line">
              <th class="p-2">
                原成员
              </th><th class="p-2">
                日薪
              </th><th class="p-2">
                加班规则
              </th><th class="p-2">
                独立加班标准
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="(row, index) in basis.rates" :key="row.workerId" class="border-b border-line">
              <td class="p-2">
                {{ names.get(row.workerId) }}
              </td><td class="p-2">
                <input :value="row.dailyWage ?? ''" :aria-label="`${names.get(row.workerId)}更正日薪`" type="number" min="0" step="any" class="field-input w-28" :disabled="disabled" @input="update('rates', index, 'dailyWage', amount($event))">
              </td><td class="p-2">
                {{ row.overtimeRule === 'explicit' ? '独立标准' : '日薪的八分之一' }}
              </td><td class="p-2">
                <input v-if="row.overtimeRule === 'explicit'" :value="row.overtimeRate ?? ''" :aria-label="`${names.get(row.workerId)}更正加班标准`" type="number" min="0" step="any" class="field-input w-28" :disabled="disabled" @input="update('rates', index, 'overtimeRate', amount($event))"><span v-else>按原规则计算</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div tabindex="0" aria-label="原逐日考勤更正" class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-640px text-left text-12px">
          <thead>
            <tr class="border-b border-line">
              <th class="p-2">
                原成员 / 日期
              </th><th class="p-2">
                正常工时
              </th><th class="p-2">
                加班工时
              </th><th class="p-2">
                工作内容
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="(row, index) in basis.records" :key="row.recordId" class="border-b border-line">
              <td class="p-2">
                {{ names.get(row.workerId) }} · {{ row.workDate }}
              </td><td class="p-2">
                <input :value="row.hours ?? ''" :aria-label="`第${index + 1}条正常工时`" type="number" min="0" max="8" step="any" class="field-input w-24" :disabled="disabled" @input="update('records', index, 'hours', amount($event))">
              </td><td class="p-2">
                <input :value="row.overtimeHours ?? ''" :aria-label="`第${index + 1}条加班工时`" type="number" min="0" max="24" step="any" class="field-input w-24" :disabled="disabled" @input="update('records', index, 'overtimeHours', amount($event))">
              </td><td class="p-2">
                <input :value="row.workContent" :aria-label="`第${index + 1}条工作内容`" class="field-input w-48" :disabled="disabled" @input="update('records', index, 'workContent', ($event.target as HTMLInputElement).value)">
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <template v-else>
      <label class="grid max-w-md gap-1 text-12px">更正主体单价（元 / 工）<input :value="basis.unitRate ?? ''" type="number" min="0" step="any" class="field-input" :disabled="disabled" @input="emit('change', { ...basis, unitRate: amount($event) })"></label>
      <div tabindex="0" aria-label="原逐条签工更正" class="min-w-0 overflow-x-auto">
        <table class="w-full min-w-1080px text-left text-12px">
          <thead>
            <tr class="border-b border-line">
              <th class="p-2">
                原成员 / 日期
              </th><th class="p-2">
                工数
              </th><th class="p-2">
                开始
              </th><th class="p-2">
                结束
              </th><th class="p-2">
                工作内容
              </th><th class="p-2">
                证明人
              </th><th class="p-2">
                确认日期
              </th>
            </tr>
          </thead><tbody>
            <tr v-for="(row, index) in basis.records" :key="row.recordId" class="border-b border-line">
              <td class="p-2">
                {{ names.get(row.workerId) }} · {{ row.workDate }}
              </td><td class="p-2">
                <select :value="row.laborUnits ?? ''" :aria-label="`第${index + 1}条更正工数`" class="field-input w-24" :disabled="disabled" @change="update('records', index, 'laborUnits', amount($event))">
                  <option value="">
                    未填写
                  </option><option value="0.5">
                    半工
                  </option><option value="1">
                    整工
                  </option>
                </select>
              </td><td v-for="field in ['startTime', 'endTime'] as const" :key="field" class="p-2">
                <input :value="row[field]" :aria-label="`第${index + 1}条${field === 'startTime' ? '开始' : '结束'}时间`" type="time" class="field-input w-28" :disabled="disabled" @input="update('records', index, field, ($event.target as HTMLInputElement).value)">
              </td><td class="p-2">
                <input :value="row.workContent" :aria-label="`第${index + 1}条更正工作内容`" class="field-input w-48" :disabled="disabled" @input="update('records', index, 'workContent', ($event.target as HTMLInputElement).value)">
              </td><td class="p-2">
                <input :value="row.witness" :aria-label="`第${index + 1}条更正证明人`" class="field-input w-32" :disabled="disabled" @input="update('records', index, 'witness', ($event.target as HTMLInputElement).value)">
              </td><td class="p-2">
                <input :value="row.confirmedOn" :aria-label="`第${index + 1}条更正确认日期`" type="date" class="field-input w-40" :disabled="disabled" @input="update('records', index, 'confirmedOn', ($event.target as HTMLInputElement).value)">
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
    <PayrollHollowAdjustmentFields v-if="basis?.hollow" :basis="basis.hollow" :disabled="disabled" @change="emit('change', { ...basis, hollow: $event })" />
  </section>
</template>
