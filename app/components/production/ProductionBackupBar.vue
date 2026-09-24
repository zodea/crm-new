<script setup lang="ts">
import type { ProductionBackupAction } from '~/lib/production/backup-contract'
import { useIntervalFn } from '@vueuse/core'
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import { backupProtectionLabels, backupTime } from '~/lib/production/backup-presentation'
import { useProductionAccessStore } from '~/stores/production-access'
import { useProductionBackupStore } from '~/stores/production-backup'
import ProductionBackupDialog from './ProductionBackupDialog.vue'

const access = useProductionAccessStore()
const store = useProductionBackupStore()
const open = shallowRef(false)
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const enabled = computed(() => access.status?.mode === 'production' && access.status.authenticated)
const label = computed(() => store.problem ? '备份状态暂不可用' : store.current ? backupProtectionLabels[store.current.protection] : '正在核对备份状态')
function refresh() {
  if (enabled.value && access.allowed && !store.busy)
    void store.refresh()
}
async function action(value: ProductionBackupAction) {
  await store.perform(value)
}
onMounted(refresh)
useIntervalFn(refresh, 60_000)
</script>

<template>
  <div v-if="enabled" class="flex shrink-0 flex-wrap items-center justify-between gap-1 border-b border-line bg-surface px-4 py-1.5 text-11px" aria-label="备份保护" role="status">
    <span class="min-w-0 break-words" :class="store.problem || store.current?.protection !== 'protected' ? 'text-danger' : 'text-ink-muted'">{{ label }}<span v-if="store.current?.latest"> · 资料截至 {{ backupTime(store.current.latest.capturedAt) }}</span></span>
    <button ref="trigger" type="button" class="btn-ghost shrink-0" @click="open = true">
      备份与恢复
    </button>
    <ProductionBackupDialog v-model:open="open" :status="store.current" :busy="store.busy" :problem="store.problem" :pending="store.pending" :result="store.lastResult" @action="action" @retry="store.perform()" @refresh="store.refresh" @return-focus="trigger?.focus()" />
  </div>
</template>
