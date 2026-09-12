<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { DeliveryRecord } from '~/stores/delivery-record'
import { computed } from 'vue'

const props = defineProps<{ record: DeliveryRecord, busy: boolean }>()
defineEmits<{ accept: [], cancel: [] }>()
const fields = computed(() => [
  ['当前版本', props.record.version],
  ['所属项目', props.record.projectName || '名称待核验'],
  ['分供方', props.record.supplierName || '待核验'],
  ['送货单号', props.record.orderNo || '原件无单号'],
  ['送货日期', props.record.deliveryDate || '待核验'],
  ['备注', props.record.note || '—'],
])
const columns: KitTableColumn[] = [
  { field: 'materialName', title: '材料名称', minWidth: 180 },
  { field: 'spec', title: '规格型号', minWidth: 140 },
  { field: 'unit', title: '单位', width: 80 },
  { field: 'qty', title: '数量', width: 100, align: 'right' },
  { field: 'unitPrice', title: '单价', type: 'money', width: 120 },
  { field: 'amount', title: '金额', type: 'money', width: 130 },
  { field: 'note', title: '备注', minWidth: 150 },
]
</script>

<template>
  <section aria-label="核对当前送货记录" class="panel flex min-w-0 flex-col gap-4 p-4">
    <div>
      <h2 class="text-15px font-700 text-ink">
        核对当前送货记录
      </h2>
      <p class="mt-1 text-13px text-ink-soft">
        以下为刚读取的当前记录，只读供对照。您的人工稿仍保留在下方表单中，请逐项调整后再保存。
      </p>
    </div>
    <dl class="grid min-w-0 gap-x-6 text-13px sm:grid-cols-2">
      <div v-for="field in fields" :key="field[0]" class="flex min-w-0 gap-3 border-b border-line py-2">
        <dt class="w-24 shrink-0 text-ink-soft">
          {{ field[0] }}
        </dt>
        <dd class="min-w-0 whitespace-pre-wrap break-words text-ink">
          {{ field[1] }}
        </dd>
      </div>
    </dl>
    <KitTable :columns="columns" :data="[...record.lines]" :min-rows="1" empty="当前记录没有材料明细" />
    <div class="flex flex-wrap gap-2">
      <KitButton :disabled="busy" @click="$emit('cancel')">
        暂不采用
      </KitButton>
      <KitButton variant="primary" :disabled="busy" @click="$emit('accept')">
        采用已核对的当前版本
      </KitButton>
    </div>
  </section>
</template>
