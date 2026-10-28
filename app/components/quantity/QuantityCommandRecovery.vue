<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { computed, shallowRef } from 'vue'
import { useQuantityStore } from '~/stores/quantity'

const props = defineProps<{ surface: 'matrix' | 'templates' | 'region' | 'assignments' | 'completion' | 'batch' | 'stages', projectId: string }>()
const access = useProductionAccessStore()
const quantity = useQuantityStore()
const stages = useQuantityStageStore()
const busy = shallowRef(false)
const problem = shallowRef('')
const pending = computed(() => {
  const rows = props.surface === 'stages'
    ? stages.pendingOperations
    : props.surface === 'region'
      ? quantity.pendingRegion
      : props.surface === 'templates'
        ? quantity.pendingTemplates
        : props.surface === 'assignments'
          ? quantity.pendingAssignments
          : props.surface === 'completion' ? quantity.pendingCompletion : props.surface === 'batch' ? quantity.pendingBatch : quantity.pendingMatrix
  return access.status?.mode === 'production' ? rows.filter(row => row.scopeId === props.projectId) : []
})
async function recover(descriptor: CommandRecoveryDescriptor) {
  if (busy.value)
    return
  busy.value = true
  problem.value = ''
  try {
    const operation = props.surface === 'stages'
      ? stages.recover
      : props.surface === 'region'
        ? quantity.recoverRegion
        : props.surface === 'templates'
          ? quantity.recoverTemplates
          : props.surface === 'assignments'
            ? quantity.recoverAssignments
            : props.surface === 'completion' ? quantity.recoverCompletion : props.surface === 'batch' ? quantity.recoverBatch : quantity.recoverMatrix
    await operation(descriptor)
  }
  catch (cause) { problem.value = cause instanceof Error ? cause.message : '原工程量提交暂未核对，请保留当前输入。' }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="pending.length" class="grid min-w-0 gap-3">
    <CommandRecoveryPanel v-for="descriptor in pending" :key="descriptor.commandId" :command-id="descriptor.commandId" :saved="false" :busy="busy" @recover="recover(descriptor)" />
    <p v-if="problem" role="alert" class="m-0 text-13px text-danger">
      {{ problem }}
    </p>
  </div>
</template>
