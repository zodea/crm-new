<script setup lang="ts">
import type { PayrollAFrozenDocument } from '~/lib/payroll/central-a-contract'
import { computed } from 'vue'
import { payrollALocationOutput } from '~/lib/payroll/a-location-output'

const props = defineProps<{ document: PayrollAFrozenDocument }>()
const locations = computed(() => payrollALocationOutput(props.document))
</script>

<template>
  <section class="frozen-locations" aria-label="原冻结施工范围">
    <h2>原冻结施工范围</h2>
    <p v-for="reason in locations.diagnostics" :key="reason" class="location-note">
      {{ reason }}
    </p>
    <section v-for="group in locations.groups" :key="group.key" class="location-group">
      <h3>{{ group.buildingName }} · {{ group.itemName }}（{{ group.unit || '单位未记录' }}）</h3>
      <p class="location-range">
        {{ group.floors }}
      </p>
      <div class="location-scroll" tabindex="0" :aria-label="`${group.buildingName} ${group.itemName} 原位置明细`">
        <table>
          <thead>
            <tr><th>楼层</th><th>户</th><th>房间</th><th>原责任人</th><th>责任范围</th><th>原现场量</th><th>原完成日期</th></tr>
          </thead>
          <tbody>
            <tr v-for="fact in group.records" :key="`${fact.lineId}:${fact.ownershipKey}:${fact.completionId}`">
              <td>{{ fact.floorName || '未记录' }}</td><td>{{ fact.unitName || '未记录' }}</td><td>{{ fact.roomName || '未记录' }}</td><td>{{ fact.workerName || fact.crewName || '未记录' }}</td><td>{{ fact.scopeKind === 'selected' ? '限定房间分项' : '原工种范围' }}</td><td>{{ fact.fieldQty ?? '未知' }}</td><td>{{ fact.completedAt || '未记录' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.frozen-locations { min-width: 0; margin: 1rem 0; }
h2 { margin: 0 0 .5rem; font-size: 14px; font-weight: 600; }
h3 { margin: 0; font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.location-note { margin: .25rem 0; font-size: 12px; line-height: 1.6; }
.location-group { margin-top: 1rem; }
.location-range { margin: .25rem 0 .5rem; font-size: 12px; overflow-wrap: anywhere; }
.location-scroll { max-width: 100%; overflow-x: auto; outline-offset: 2px; }
table { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 12px; }
th, td { padding: .5rem; border: 1px solid var(--line); text-align: left; overflow-wrap: anywhere; }
th { font-weight: 600; }
@media print {
  .frozen-locations { margin-top: 6mm; }
  h2 { font-size: 11pt; break-after: avoid; }
  h3 { font-size: 10pt; break-after: avoid; }
  .location-range, .location-note { font-size: 8pt; }
  .location-range { break-after: avoid; }
  .location-scroll { overflow: visible; }
  table { min-width: 0; table-layout: fixed; font-size: 8pt; }
  th, td { padding: 1.5mm; border: .25mm solid #111827; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
}
</style>
