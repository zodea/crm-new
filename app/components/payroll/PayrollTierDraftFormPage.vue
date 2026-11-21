<script setup lang="ts">
import type { usePayrollC1Form } from '~/composables/usePayrollC1Form'
import type { usePayrollC2Form } from '~/composables/usePayrollC2Form'
import { computed } from 'vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import KitButton from '~/components/ui/KitButton.vue'
import SectionHeader from '~/components/ui/SectionHeader.vue'
import PayrollACommandState from './PayrollACommandState.vue'
import PayrollHollowReview from './PayrollHollowReview.vue'

type DraftForm = ReturnType<typeof usePayrollC1Form> | ReturnType<typeof usePayrollC2Form>
type DraftPatch = Parameters<DraftForm['change']>[0]

const props = defineProps<{
  tier: 'C1' | 'C2'
  title: string
  ui: DraftForm
  returnTo: string
}>()
defineSlots<{
  fields: (props: { change: (patch: DraftPatch) => Promise<void> }) => unknown
  config: () => unknown
  source: () => unknown
}>()

const { matchingRead, draft, loading, busy, error, pending, editable, latest, formElement, previewed, canSave } = props.ui
const source = computed(() => props.tier === 'C1' ? '考勤' : '签工')
const subtitle = computed(() => props.tier === 'C1'
  ? '按真实逐日考勤与个人标准核算，保存后核对并确认实际发放。'
  : '按真实逐条签工与主体配置核算，保存后核对并确认实际发放。')
const sections = computed(() => [{ key: 'basic', label: '请款范围' }, { key: 'source', label: `${source.value}与标准` }, { key: 'note', label: '备注' }])

async function change(patch: DraftPatch) {
  props.ui.change(patch)
  if (['projectId', 'month', 'crewId', 'leaderWorkerId'].some(key => key in patch))
    await props.ui.load(true)
}
</script>

<template>
  <EntityFormShell :title="title" :subtitle="subtitle" back-label="返回工资台账" :sections="sections" :state="!matchingRead ? loading ? 'loading' : 'error' : 'ready'" state-title="工资草稿未能读取" :state-description="error" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load()">
    <PayrollACommandState :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load()" />
    <p v-if="latest" class="panel my-3 p-3 text-12px">
      资料已重新读取，原稿与保存依据仍保留；请明确核对当前{{ source }}与标准。
    </p>
    <form v-if="matchingRead" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.save">
      <slot name="fields" :change="change" />
      <div class="flex flex-wrap gap-2">
        <KitButton type="button" :disabled="busy || !!pending" @click="ui.load(true)">
          {{ tier === 'C1' ? '核对考勤与个人标准' : '核对签工与主体配置' }}
        </KitButton>
        <slot name="config" />
      </div>
      <p v-if="!previewed" class="text-12px text-warn">
        范围或成员已改变，请按当前稿重新核对来源后保存。
      </p>
      <slot name="source" />
      <PayrollHollowReview v-if="matchingRead.hollow" :read="matchingRead.hollow" :return-to="returnTo" readonly :blocked="busy || !!pending" />
      <section id="section-note" class="panel p-4">
        <SectionHeader title="备注" /><textarea :value="draft.note" class="field-input mt-3 w-full min-w-0" rows="3" aria-label="工资备注" :disabled="!editable" @input="ui.change({ note: ($event.target as HTMLTextAreaElement).value })" />
      </section>
    </form>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.leave">
          取消
        </KitButton><KitButton variant="primary" :disabled="!canSave" @click="ui.save">
          {{ busy ? '正在保存…' : '保存工资草稿' }}
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
