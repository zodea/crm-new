<script setup lang="ts">
import type { PayrollC1Draft } from '~/lib/payroll/central-c1-contract'
import { computed } from 'vue'
import { usePayrollC1Form } from '~/composables/usePayrollC1Form'

const route = useRoute()
const ui = usePayrollC1Form()
const { id, matchingRead, draft, loading, busy, error, fieldErrors, pending, editable, latest, formElement, previewed, canSave } = ui
const title = computed(() => id.value ? '编辑 C1 工资草稿' : '新建 C1 工资草稿')
const config = computed(() => ({ path: '/subcontract/payroll/config', query: { format: 'C1', origin: 'real', project: draft.value.projectId, month: draft.value.month, crew: draft.value.crewId || '', returnTo: route.fullPath } }))
async function change(patch: Partial<PayrollC1Draft>) {
  ui.change(patch)
  if (['projectId', 'month', 'crewId', 'leaderWorkerId'].some(key => key in patch))
    await ui.load(true)
}
useTabTitle(title)
</script>

<template>
  <EntityFormShell :title="title" subtitle="按真实逐日考勤与个人标准核算，保存后核对并确认实际发放。" back-label="返回工资台账" :sections="[{ key: 'basic', label: '请款范围' }, { key: 'source', label: '考勤与标准' }, { key: 'note', label: '备注' }]" :state="!matchingRead ? loading ? 'loading' : 'error' : 'ready'" state-title="工资草稿未能读取" :state-description="error" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load()">
    <PayrollACommandState :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load()" />
    <p v-if="latest" class="panel my-3 p-3 text-12px">
      资料已重新读取，原稿与保存依据仍保留；请明确核对当前考勤与标准。
    </p>
    <form v-if="matchingRead" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.save">
      <PayrollC1FormFields :draft="draft" :options="matchingRead.options" :disabled="!editable" :field-errors="fieldErrors" @patch="change" />
      <div class="flex flex-wrap gap-2">
        <KitButton type="button" :disabled="busy || !!pending" @click="ui.load(true)">
          核对考勤与个人标准
        </KitButton><NuxtLink v-if="draft.projectId && draft.month" :to="config" class="btn-secondary">
          个人工资标准
        </NuxtLink>
      </div>
      <p v-if="!previewed" class="text-12px text-warn">
        范围或成员已改变，请按当前稿重新核对来源后保存。
      </p>
      <PayrollC1SourceReview :read="matchingRead" :return-to="route.fullPath" />
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
