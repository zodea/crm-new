<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import { computed } from 'vue'

const props = defineProps<{ record: CentralInvoiceRecord, records: readonly CentralInvoiceRecord[], dirty: boolean, busy: boolean }>()
const emit = defineEmits<{ select: [id: string] }>()

// 服务端将当前票号用 JS trim，其他记录的票号用 SQLite trim（默认仅 ASCII 空格）。
// 此处只用于最近一次读取的候选提示，提交仍由服务端复核。
const candidates = computed(() => {
  const number = props.record.fields.invoiceNumber.trim()
  if (!number)
    return []
  return props.records.filter(record => record.id !== props.record.id && record.deletedAt === null
    && record.fields.invoiceNumber.replace(/^ +| +$/g, '') === number)
})
const visible = computed(() => props.record.duplicateStatus === 'duplicate' || candidates.value.length > 0)
</script>

<template>
  <section v-if="visible" aria-label="同票号候选" class="rounded border border-line bg-panel p-3 text-sm">
    <h2 class="font-600">
      同票号候选
    </h2>
    <p v-if="record.duplicateStatus === 'duplicate'" class="mt-1 text-warn-ink">
      此票曾标记为重复，请核对。
    </p>
    <p v-if="dirty" class="mt-1">
      此处依据已保存票号；未保存修改尚未参与核对。
    </p>
    <p class="mt-1">
      以下信息依据最近读取的记录，能否确认以提交时复核为准。
    </p>
    <ul v-if="candidates.length" class="mt-2 space-y-2">
      <li v-for="candidate in candidates" :key="candidate.id" class="break-all">
        <button type="button" :disabled="busy" class="text-left text-brand underline" @click="emit('select', candidate.id)">
          票号 {{ candidate.fields.invoiceNumber }}（ID：{{ candidate.id }}）
        </button>
        <span class="ml-1 text-ink-soft">{{ candidate.accountStatus === 'archived' ? '已归档' : '未归档' }}{{ candidate.duplicateStatus === 'duplicate' ? '，曾标记为重复' : '' }}</span>
      </li>
    </ul>
    <p v-else class="mt-1">
      最近读取的列表中未找到同票号记录；标记可能已过期，请重新读取后核对。
    </p>
  </section>
</template>
