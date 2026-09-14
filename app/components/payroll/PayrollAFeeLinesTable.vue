<script setup lang="ts">
import type { PayrollAFeeLine } from '~/lib/payroll/central-a-fees-contract'
import type { NavigationIntentDTO } from '~/types/read-model'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { payrollAmountSummary } from '~/lib/payroll/a-presentation'
import { payrollNumber } from '~/lib/payroll/read-presentation'

defineProps<{ lines: PayrollAFeeLine[], returnTo?: string }>()
function sourceLocation(source: NavigationIntentDTO, feeId: string, returnTo?: string) {
  if (!returnTo)
    return null
  const back = new URL(returnTo, 'https://payroll.invalid')
  back.searchParams.set('focus', feeId)
  const result = resolveNavigationTarget(source, { returnTo: `${back.pathname}${back.search}` })
  return result.state === 'resolved' ? result.to : null
}
const prices = (line: PayrollAFeeLine) => [...new Set(line.components.map(component => component.unitPrice === null ? '未配置' : payrollNumber(component.unitPrice)))].join('、')
</script>

<template>
  <div class="fee-table-scroll min-w-0 overflow-x-auto" tabindex="0" role="region" aria-label="逐项费用与基数">
    <table class="fee-table w-full min-w-760px text-12px">
      <thead><tr><th>费用</th><th>楼栋 / 分项</th><th>单位</th><th>原完成量</th><th>费用单价</th><th>金额</th><th>依据</th></tr></thead>
      <tbody>
        <tr v-for="line in lines" :key="line.id" :data-fee-focus="line.feeId" tabindex="-1">
          <td>{{ line.name }}<span class="block text-ink-faint">{{ { housing: '房补', subsidy: '补贴', management: '管理费' }[line.kind] }}</span></td><td>{{ line.buildingName || '楼栋未记录' }} / {{ line.itemName || '分项未记录' }}</td><td>{{ line.unit || '未记录' }}</td><td>{{ line.quantity === null ? line.knownQuantity === null ? '未知' : `已知 ${payrollNumber(line.knownQuantity)} · 未齐` : payrollNumber(line.quantity) }}</td><td>{{ prices(line) }}</td><td>{{ payrollAmountSummary(line.amount) }}</td><td>
            <div class="grid max-h-24 gap-1 overflow-y-auto whitespace-normal break-words" tabindex="0">
              <p v-for="blocker in line.blockers" :key="blocker.code" class="text-warn">
                {{ blocker.message }}
              </p><template v-for="(source, index) in line.sources" :key="index">
                <NuxtLink v-if="sourceLocation(source, line.feeId, returnTo)" :to="sourceLocation(source, line.feeId, returnTo)!" class="cell--link">
                  原完成来源 {{ index + 1 }}
                </NuxtLink>
              </template><span>{{ line.components.length }} 份原完成依据</span>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!lines.length" class="p-3 text-12px text-ink-faint">
      当前已证范围没有费用行。
    </p>
  </div>
</template>

<style scoped>
.fee-table { border-collapse: collapse; }
.fee-table th, .fee-table td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; overflow-wrap: anywhere; }
.fee-table th { font-weight: 700; }
@media print {
  .fee-table-scroll { overflow: visible; }
  .fee-table { min-width: 0; table-layout: fixed; font-size: 8pt; }
  .fee-table th, .fee-table td { padding: 1.5mm; border: .25mm solid #111827; }
  .fee-table thead { display: table-header-group; }
  .fee-table tr { break-inside: avoid; }
  .fee-table td > div { max-height: none; overflow: visible; }
}
</style>
