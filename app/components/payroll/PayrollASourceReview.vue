<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { PayrollABlocker, PayrollAFormRead, PayrollALine } from '~/lib/payroll/central-a-contract'
import type { NavigationIntentDTO } from '~/types/read-model'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, shallowRef, watch } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { payrollAmountSummary } from '~/lib/payroll/a-presentation'
import { payrollAmount, payrollNumber } from '~/lib/payroll/read-presentation'
import PayrollAFloorReview from './PayrollAFloorReview.vue'

const props = defineProps<{ read: PayrollAFormRead, returnTo: string, editable?: boolean }>()
const emit = defineEmits<{ price: [line: PayrollALine] }>()
const route = useRoute()
const section = shallowRef<HTMLElement | null>(null)
const active = shallowRef(true)
const selectedFloor = shallowRef('')
const selectedItemId = shallowRef('')
const crewSource = computed<NavigationIntentDTO | null>(() => props.read.draft.crewId && props.read.context.capabilities.includes('crew:list:read') ? { kind: 'entity-detail', subject: { state: 'resolved', entity: 'crew', id: props.read.draft.crewId, label: props.read.options.crews.find(crew => crew.id === props.read.draft.crewId)?.name || '班组', no: null }, variant: 'detail', view: null, filters: { projectId: props.read.draft.projectId || '', dataOrigin: props.read.context.origin } } : null)
const floors = computed(() => [...new Map(props.read.facts.map(fact => [fact.floorId, { id: fact.floorId, label: `${fact.buildingName || '楼栋未记录'} · ${fact.floorName || '楼层未记录'}`, count: props.read.facts.filter(value => value.floorId === fact.floorId).length }])).values()])
const lines = computed(() => selectedFloor.value ? props.read.lines.filter(line => line.facts.some(fact => fact.floorId === selectedFloor.value)) : props.read.lines)
const columns: KitTableColumn[] = [{ field: 'workerName', title: '工人', minWidth: 120, fixed: 'left' }, { field: 'itemName', title: '栋 / 户型 / 分项', minWidth: 235, slot: 'item' }, { field: 'unit', title: '单位', width: 90, slot: 'unit' }, { field: 'quantity', title: '已完成现场量', minWidth: 145, slot: 'quantity', align: 'right' }, { field: 'unitPrice', title: '工资单价', minWidth: 120, slot: 'price', align: 'right' }, { field: 'amount', title: '金额', minWidth: 130, slot: 'amount', align: 'right' }, { field: 'blockers', title: '来源核对', minWidth: 230, slot: 'sources' }]
const amounts = computed(() => [{ label: '本期完成金额', value: props.read.totals.workAmount }, { label: '累计应付', value: props.read.totals.cumulativeAmount }, { label: '此前实际已发', value: props.read.totals.previouslyPaid }, { label: '本次核算应发', value: props.read.totals.grossAmount }])
function location(intent: NavigationIntentDTO | null, focus?: string) {
  if (!intent)
    return null
  const back = new URL(props.returnTo, 'https://payroll.invalid')
  if (focus)
    back.searchParams.set('focus', focus)
  const result = resolveNavigationTarget(intent, { returnTo: `${back.pathname}?${back.searchParams}` })
  return result.state === 'resolved' ? result.to : null
}
function sourceFocus(line: PayrollALine, source: NavigationIntentDTO): string | undefined {
  if ((source.kind !== 'entity-detail' && source.kind !== 'entity-subview' && source.kind !== 'source-record') || source.subject.state !== 'resolved' || source.subject.entity !== 'quantity-unit')
    return undefined
  const unitId = source.subject.id
  return line.facts.find(fact => fact.unitId === unitId && fact.stageId === source.filters.stageId && fact.completionId === source.filters.completionId)?.completionId
}
function originalReferences(blocker: PayrollABlocker) {
  return [{ label: '原完成记录', value: blocker.completionId }, { label: '原责任记录', value: blocker.assignmentId }, { label: '原户', value: blocker.unitId }, { label: '原房间', value: blocker.roomId }, { label: '原分项', value: blocker.itemId }].filter(row => row.value)
}
let focusSequence = 0
async function restoreFocus() {
  const focus = route.query.focus
  const request = ++focusSequence
  const path = route.fullPath
  if (!active.value || typeof focus !== 'string' || !props.read.facts.some(fact => fact.completionId === focus))
    return
  const fact = props.read.facts.find(fact => fact.completionId === focus)!
  selectedFloor.value = fact.floorId
  await nextTick()
  if (!active.value || request !== focusSequence || route.fullPath !== path)
    return
  const element = [...section.value?.querySelectorAll<HTMLElement>('[data-source-focus]') ?? []].find(element => element.dataset.sourceFocus === focus && element.getClientRects().length)
  element?.scrollIntoView({ block: 'center', inline: 'center' })
  element?.focus({ preventScroll: true })
}
watch([() => route.query.focus, () => props.read], () => void restoreFocus(), { immediate: true, flush: 'post' })
onActivated(() => {
  active.value = true
  void restoreFocus()
})
onDeactivated(() => {
  active.value = false
  focusSequence += 1
})
onScopeDispose(() => {
  active.value = false
  focusSequence += 1
})
function name(line: PayrollALine) {
  return line.itemName || '分项名称未记录'
}
</script>

<template>
  <section id="section-source" ref="section" class="panel grid grid-cols-1 min-w-0 scroll-mt-4 gap-4 overflow-hidden p-4" aria-label="A工资完成来源核对">
    <SectionHeader title="核对实际完成与现场量" :mb="0" />
    <PayrollAFloorReview :facts="read.facts" :month="read.draft.month || ''" :hollow="read.hollow" :selected-item-id="selectedItemId" :return-to="returnTo" @floor="selectedFloor = $event" />
    <p data-payroll-source-description class="min-w-0 whitespace-normal break-words text-12px leading-5 text-ink-faint">
      数量只读；未记录的值不会补成零，姓名和合同价格不用于替换原责任与工资配置。
    </p>
    <div data-payroll-source-summary class="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
      <div v-for="amount in amounts" :key="amount.label" class="min-w-0 rounded border border-line p-3">
        <span class="text-12px text-ink-faint">{{ amount.label }}</span><p class="mt-1 break-words font-mono text-14px font-700">
          {{ payrollAmountSummary(amount.value) }}
        </p><p v-for="reason in amount.value.reasons" :key="reason" class="mt-1 break-all text-11px leading-4 text-warn">
          {{ reason }}
        </p>
      </div>
    </div>
    <div class="flex flex-wrap items-center gap-3 text-12px" aria-label="工资人员与班组来源">
      <NuxtLink v-if="location(crewSource)" :to="location(crewSource)!" class="cell--link">
        查看请款班组
      </NuxtLink><template v-for="member in read.members" :key="member.id">
        <NuxtLink v-if="location(member.source)" :to="location(member.source)!" class="cell--link">
          {{ member.name || '姓名未记录' }}
        </NuxtLink><span v-else>{{ member.name || '姓名未记录' }}</span>
      </template>
    </div>
    <section v-if="read.blockers.length" class="grid gap-2 rounded border border-warn/30 bg-warn-soft p-3 text-12px" aria-label="工资来源缺口">
      <p class="font-700">
        尚有 {{ read.blockers.length }} 项需要核对
      </p><div v-for="(blocker, index) in read.blockers" :key="`${blocker.code}-${index}`" class="grid min-w-0 gap-1 border-t border-warn/20 pt-2">
        <p v-if="blocker.locationLabel" class="break-words font-700">
          {{ blocker.locationLabel }}
        </p><p class="break-words">
          {{ blocker.message }}
        </p><NuxtLink v-if="location(blocker.source)" :to="location(blocker.source)!" class="cell--link justify-self-start">
          查看原来源
        </NuxtLink><p v-else-if="blocker.sourceUnavailableReason" class="break-words text-ink-dim">
          {{ blocker.sourceUnavailableReason }}
        </p><details v-if="originalReferences(blocker).length" class="min-w-0 text-11px text-ink-faint">
          <summary class="cursor-pointer">
            原记录编号
          </summary><dl class="mt-2 grid gap-1">
            <div v-for="reference in originalReferences(blocker)" :key="reference.label" class="grid min-w-0 gap-1 sm:grid-cols-[7rem_1fr]">
              <dt>{{ reference.label }}</dt><dd class="break-all">
                {{ reference.value }}
              </dd>
            </div>
          </dl>
        </details>
      </div>
    </section>
    <div v-if="floors.length" class="flex flex-wrap gap-2" aria-label="已完成楼层分布">
      <KitButton type="button" :variant="!selectedFloor ? 'primary' : 'secondary'" @click="selectedFloor = ''">
        全部楼层
      </KitButton><KitButton v-for="floor in floors" :key="floor.id" type="button" :variant="selectedFloor === floor.id ? 'primary' : 'secondary'" @click="selectedFloor = floor.id">
        {{ floor.label }} · {{ floor.count }} 项
      </KitButton>
    </div>
    <div class="min-w-0 overflow-hidden">
      <KitTable :columns="columns" :data="lines" :row-height="64" :min-rows="3" :empty="{ title: '当前没有已证明的完成工资行', description: '请选择项目、负责人、月份与成员，再核对实际完成来源。' }">
        <template #item="{ row }">
          <button type="button" class="max-h-13 overflow-y-auto whitespace-normal break-words text-left leading-5" :aria-pressed="selectedItemId === row.itemId" @click="selectedItemId = row.itemId">
            {{ name(row) }}
          </button>
        </template>
        <template #unit="{ row }">
          {{ row.unit || '未记录' }}
        </template>
        <template #quantity="{ row }">
          <span>{{ row.quantity === null ? row.knownQuantity === null ? '未知' : `已知 ${payrollNumber(row.knownQuantity)} · 未齐` : payrollNumber(row.quantity) }}</span>
        </template>
        <template #price="{ row }">
          <button v-if="editable" type="button" class="cell--link" @click="emit('price', row)">
            {{ payrollAmount(row.unitPrice) }}
          </button><span v-else>{{ payrollAmount(row.unitPrice) }}</span><span v-if="row.priceRevisionIds.some((id: string) => read.prices.some(price => price.id === id && price.mode === 'worker-exception'))" class="ml-1 text-11px text-warn">调</span>
        </template>
        <template #amount="{ row }">
          {{ payrollAmount(row.amount) }}
        </template>
        <template #sources="{ row }">
          <div tabindex="0" class="max-h-13 overflow-y-auto whitespace-normal break-words text-12px leading-5" aria-label="工资行来源">
            <p v-for="blocker in row.blockers" :key="blocker.code" class="text-warn">
              {{ blocker.message }}
            </p><template v-for="(source, index) in row.sources" :key="index">
              <NuxtLink v-if="sourceFocus(row, source) && location(source, sourceFocus(row, source))" :to="location(source, sourceFocus(row, source))!" :data-source-focus="sourceFocus(row, source)" class="cell--link mr-2">
                查看来源 {{ index + 1 }}
              </NuxtLink><span v-else class="text-ink-faint">来源入口不可用</span>
            </template>
          </div>
        </template>
      </KitTable>
    </div>
  </section>
</template>
