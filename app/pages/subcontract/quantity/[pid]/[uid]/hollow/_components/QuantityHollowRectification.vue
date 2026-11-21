<script setup lang="ts">
import type { QuantityUnitReadQuery } from '~/lib/quantity/central-contract'
import KitButton from '~/components/ui/KitButton.vue'
import { useQuantityHollowForm } from '~/composables/useQuantityHollowForm'
import QuantityHollowCommandState from '../../../../../../../components/quantity/QuantityHollowCommandState.vue'
import QuantityHollowInspectionFields from '../../../../../../../components/quantity/QuantityHollowInspectionFields.vue'
import QuantityHollowPendingSummary from '../../../../../../../components/quantity/QuantityHollowPendingSummary.vue'

const props = defineProps<{ query: QuantityUnitReadQuery, recordId: string }>()
const emit = defineEmits<{ saved: [] }>()
const ui = useQuantityHollowForm({ query: () => props.query, mode: 'rectify', recordId: () => props.recordId, draftKey: () => '', saved: async () => {
  emit('saved')
  await ui.load()
} })
const { read, record, fields, pending, pendingElsewhere, busy, editable, canSave, needsRecheck, error, fieldErrors, errorPanel, formElement } = ui
</script>

<template>
  <section class="grid min-w-0 gap-3" aria-label="追加整改销记">
    <QuantityHollowCommandState ref="errorPanel" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load" />
    <QuantityHollowPendingSummary v-if="pendingElsewhere && pending && read" :action="pending.command.action" :read="read" />
    <section v-if="needsRecheck" class="panel grid gap-2 p-3 text-12px" role="status">
      <p>原整改输入已保留，记录已变化。请先重新核对本次余量。</p><KitButton class="justify-self-start" :disabled="busy || !!pending" @click="ui.adoptLatest">
        采用本次原户依据
      </KitButton>
    </section>
    <form v-if="read && record && !pendingElsewhere" ref="formElement" class="grid min-w-0 gap-3" @submit.prevent="ui.submit">
      <QuantityHollowInspectionFields :read="read" :record="record" mode="rectify" :fields="fields" :disabled="!editable || !record.eligibility.rectify.allowed" :errors="fieldErrors" @patch="ui.change" />
      <p v-for="reason in record.eligibility.rectify.reasons" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p><KitButton type="submit" class="justify-self-start" :disabled="!canSave">
        {{ busy ? '正在核对保存…' : '登记本次整改' }}
      </KitButton>
    </form>
  </section>
</template>
