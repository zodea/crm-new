<script setup lang="ts">
import { computed } from 'vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import KitButton from '~/components/ui/KitButton.vue'
import { useQuantityHollowForm } from '~/composables/useQuantityHollowForm'
import { quantityHollowPath, quantityHollowQuery, quantityHollowSourceQuery } from '~/lib/quantity/hollow-navigation'
import { isQuantitySourceIdentity } from '~/lib/quantity/migration-identity'
import { generateId } from '~/lib/util/id'
import { isStableRouteIdentity } from '~/lib/util/stable-route-identity'
import QuantityHollowCommandState from './QuantityHollowCommandState.vue'
import QuantityHollowInspectionFields from './QuantityHollowInspectionFields.vue'
import QuantityHollowPendingSummary from './QuantityHollowPendingSummary.vue'

const props = defineProps<{ projectId: string, unitId: string, recordId?: string }>()
const route = useRoute()
const router = useRouter()
const generatedKey = generateId('hollow-draft')
const draftKey = computed(() => typeof route.query.draftKey === 'string' ? route.query.draftKey : generatedKey)
const query = computed(() => (!props.recordId || isQuantitySourceIdentity(props.recordId, 'quantity_hollow_records')) && isStableRouteIdentity(draftKey.value) ? quantityHollowQuery(props.projectId, props.unitId, route.query.origin ?? 'real') : null)
const mode = props.recordId ? 'revise' : 'create'
const title = mode === 'revise' ? '修订空鼓检查' : '记录空鼓检查'
async function navigate(mode: 'unit' | 'detail', recordId?: string) {
  if (query.value)
    await router.push({ path: quantityHollowPath(query.value, mode, recordId), query: quantityHollowSourceQuery(query.value, route.query) })
}
const ui = useQuantityHollowForm({ query: () => query.value, mode, recordId: () => props.recordId ?? null, draftKey: () => draftKey.value, saved: result => navigate('detail', result.hollow.recordId) })
const { read, record, fields, pending, pendingElsewhere, busy, editable, canSave, needsRecheck, error, fieldErrors, errorPanel, formElement, loading } = ui
async function cancel() {
  if (await ui.mayDiscard())
    await navigate(props.recordId ? 'detail' : 'unit', props.recordId)
}
if (!props.recordId && route.query.draftKey === undefined)
  void router.replace({ path: route.path, query: { ...route.query, draftKey: generatedKey } })
useTabTitle(title)
</script>

<template>
  <QuantityHollowCommandRecovery :project-id="projectId" :unit-id="unitId" @recovered="ui.load" />
  <EntityFormShell :title="title" subtitle="记录真实户、分项和原责任下的检查；后续修订与整改均保留原记录。" back-label="返回原户记录" :sections="[{ key: 'responsibility', label: '原位置与责任' }, { key: 'inspection', label: '检查内容' }, { key: 'evidence', label: '依据与说明' }]" :state="read ? 'ready' : loading ? 'loading' : 'error'" state-title="原户检查资料未能读取" :state-description="error" state-action-label="重新读取原户" @back="cancel" @state-action="ui.load">
    <QuantityHollowCommandState ref="errorPanel" :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load" />
    <QuantityHollowPendingSummary v-if="pendingElsewhere && pending && read" :action="pending.command.action" :read="read" />
    <PayrollASourceReturn v-if="query" kind="quantity-unit" :source-id="unitId" :project-id="projectId" :origin="query.origin" />
    <section v-if="needsRecheck" class="panel my-3 grid gap-2 p-3 text-12px" role="status">
      <p>原输入已保留。来源或整改记录已经变化，请先采用本次读取的依据，再确认保存。</p><KitButton class="justify-self-start" :disabled="busy || !!pending" @click="ui.adoptLatest">
        采用本次原户依据
      </KitButton>
    </section>
    <form v-if="read && !pendingElsewhere" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.submit">
      <QuantityHollowInspectionFields :read="read" :record="record" :mode="mode" :fields="fields" :disabled="!editable" :errors="fieldErrors" @patch="ui.change" />
      <p v-for="(diagnostic, index) in read.data.unavailable" :key="index" class="break-words text-12px text-warn" role="alert">
        {{ diagnostic.message }}
      </p><p v-for="reason in record?.eligibility.revise.reasons ?? []" :key="reason" class="text-12px text-warn">
        {{ reason }}
      </p>
    </form>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="cancel">
          取消
        </KitButton><KitButton variant="primary" :disabled="!canSave" @click="ui.submit">
          {{ busy ? '正在核对保存…' : mode === 'revise' ? '保存检查修订' : '保存空鼓检查' }}
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
