<script setup lang="ts">
import type { CommandRecoveryDescriptor } from '~/lib/forms/command-recovery'
import { computed, shallowRef } from 'vue'
import { quantityHollowQuery } from '~/lib/quantity/hollow-navigation'

const props = defineProps<{ projectId: string, unitId: string, origin?: string | null }>()
const emit = defineEmits<{ recovered: [] }>()
const route = useRoute()
const store = useQuantityHollowStore()
const busy = shallowRef(false)
const error = shallowRef('')
const query = computed(() => quantityHollowQuery(props.projectId, props.unitId, props.origin ?? route.query.origin ?? 'real'))
const pending = computed(() => store.pendingDescriptors.filter(descriptor => query.value?.origin === 'real' && descriptor.scopeId === props.projectId))
async function recover(descriptor: CommandRecoveryDescriptor) {
  if (!query.value || busy.value)
    return
  busy.value = true
  error.value = ''
  try {
    await store.recoverDescriptor(descriptor, query.value)
    emit('recovered')
  }
  catch (cause) { error.value = cause instanceof Error ? cause.message : '原空鼓提交尚未核对。' }
  finally { busy.value = false }
}
</script>

<template>
  <div v-if="pending.length" class="grid min-w-0 gap-3">
    <CommandRecoveryPanel v-for="descriptor in pending" :key="descriptor.commandId" :command-id="descriptor.commandId" :saved="false" :busy="busy" @recover="recover(descriptor)" />
    <p v-if="error" role="alert" class="text-12px text-danger">
      {{ error }}
    </p>
  </div>
</template>
