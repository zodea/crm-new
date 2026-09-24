<script setup lang="ts">
import type { PayrollAQuantityFact } from '~/lib/payroll/central-a-contract'
import type { PayrollHollowRead, PayrollHollowRow } from '~/lib/payroll/central-hollow-deduction-contract'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{ facts: PayrollAQuantityFact[], month: string, selectedItemId: string, returnTo: string, hollow?: PayrollHollowRead }>()
defineEmits<{ floor: [floorId: string] }>()
const facts = computed(() => props.facts.filter(fact => fact.completedAt.slice(0, 7) <= props.month))
const floorKey = (buildingId: string, floorId: string) => JSON.stringify([buildingId, floorId])
const floors = computed(() => [...new Map(facts.value.map(fact => [floorKey(fact.buildingId, fact.floorId), { key: floorKey(fact.buildingId, fact.floorId), id: fact.floorId, label: `${fact.buildingName || '楼栋未记录'} · ${fact.floorName || '楼层未记录'}` }])).values()])
const items = computed(() => [...new Map(facts.value.map(fact => [fact.itemId, { id: fact.itemId, label: fact.itemName || '分项未记录' }])).values()].map(item => ({ ...item, cells: floors.value.map((floor) => {
  const completed = facts.value.filter(fact => fact.itemId === item.id && floorKey(fact.buildingId, fact.floorId) === floor.key)
  const hollow = (props.hollow?.rows ?? []).filter(row => row.fact.target.itemId === item.id && floorKey(row.fact.location.buildingId, row.fact.location.floorId) === floor.key && row.fact.remainingCount > 0)
  return { key: floor.key, previous: completed.some(fact => fact.completedAt.slice(0, 7) < props.month), current: completed.some(fact => fact.completedAt.slice(0, 7) === props.month), hollow }
}) })))
function source(row: PayrollHollowRow) {
  if (!row.source)
    return null
  const target = row.fact.target
  const completions = new Set(facts.value.filter(fact => fact.unitId === target.unitId && fact.assignmentId === target.assignmentId && fact.roomId === target.roomId && fact.itemId === target.itemId).map(fact => fact.completionId))
  const back = new URL(props.returnTo, 'https://payroll.invalid')
  back.searchParams.delete('focus')
  if (completions.size === 1)
    back.searchParams.set('focus', [...completions][0]!)
  const resolved = resolveNavigationTarget(row.source, { returnTo: `${back.pathname}?${back.searchParams}` })
  return resolved.state === 'resolved' ? resolved.to : null
}
</script>

<template>
  <section class="grid min-w-0 gap-2 text-12px" aria-label="本簿实际施工楼层表">
    <h3 class="font-700">
      实际施工楼层
    </h3>
    <p class="leading-5 text-ink-soft">
      只列本簿截至本月已有完成记录的楼层。橙点表示当前仍有未整改空鼓；未涉及完成记录不代表已经排查或空鼓为零。
    </p>
    <p v-if="!floors.length" class="text-ink-faint">
      尚无已证明的施工楼层；来源缺口仍须单独核对。
    </p>
    <div v-else class="min-w-0 max-w-full overflow-x-auto rounded border border-line" tabindex="0" aria-label="施工楼层表，可横向滚动">
      <table class="w-full border-collapse text-left text-12px">
        <thead class="bg-panel-2">
          <tr>
            <th scope="col" class="sticky left-0 min-w-32 border-b border-line bg-panel-2 p-3">
              施工分项
            </th><th v-for="floor in floors" :key="floor.key" scope="col" class="min-w-36 border-b border-line p-3">
              <button type="button" class="cursor-pointer border-0 bg-transparent p-0 text-left text-inherit font-inherit hover:text-brand-deep focus-visible:outline-2 focus-visible:outline-brand focus-visible:outline-offset-2" @click="$emit('floor', floor.id)">
                {{ floor.label }}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.id" :data-floor-item="item.id" :data-selected="selectedItemId === item.id" :class="selectedItemId === item.id ? 'bg-brand-soft' : ''">
            <th scope="row" class="sticky left-0 border-b border-line bg-panel p-3 font-600" :class="selectedItemId === item.id ? '!bg-brand-soft' : ''">
              {{ item.label }}
            </th><td v-for="cell in item.cells" :key="cell.key" class="border-b border-line p-3 align-top">
              <div class="grid gap-2">
                <span v-if="cell.previous" class="whitespace-nowrap text-ink-soft">往月已完成</span><span v-if="cell.current" class="whitespace-nowrap font-700 text-brand-deep">本月新增</span><span v-if="!cell.previous && !cell.current" class="whitespace-nowrap text-ink-faint">未涉及</span><template v-for="row in cell.hollow" :key="row.fact.recordId">
                  <NuxtLink v-if="source(row)" :to="source(row)!" class="cell--link leading-5 text-warn">
                    <span aria-hidden="true">● </span>{{ row.fact.location.unitName }} · 未整改 {{ row.fact.remainingCount }} 处
                  </NuxtLink><span v-else class="leading-5 text-warn"><span aria-hidden="true">● </span>{{ row.fact.location.unitName }} · 未整改 {{ row.fact.remainingCount }} 处<span class="block text-ink-faint">{{ row.sourceUnavailableReasons.join('；') || '来源入口不可用' }}</span></span>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
