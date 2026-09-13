<script setup lang="ts">
import type { PayrollADraft } from '~/lib/payroll/central-a-contract'
import { computed } from 'vue'
import { usePayrollAForm } from '~/composables/usePayrollAForm'

const route = useRoute()
const ui = usePayrollAForm()
const { id, matchingRead, draft, loading, busy, error, fieldErrors, pending, editable, latest, formElement, previewed, canSave } = ui
const title = computed(() => id.value ? '编辑 A 工资草稿' : '新建 A 工资草稿')
const configuration = computed(() => ({ path: '/subcontract/payroll/config', query: { origin: 'real', project: draft.value.projectId, month: draft.value.month, crew: draft.value.crewId || '', leader: draft.value.leaderWorkerId, returnTo: route.fullPath } }))
async function change(patch: Partial<PayrollADraft>) {
  ui.change(patch)
  if (['projectId', 'month', 'crewId', 'leaderWorkerId', 'periodKind'].some(key => key in patch))
    await ui.load(true)
}
useTabTitle(title)
</script>

<template>
  <EntityFormShell :title="title" subtitle="只按完成时的实际责任与现场量核算；保存草稿后继续核对和确认实际发放。" back-label="返回工资台账" :sections="[{ key: 'basic', label: '请款范围' }, { key: 'source', label: '完成与单价' }, { key: 'note', label: '备注' }]" :state="!matchingRead ? loading ? 'loading' : 'error' : 'ready'" state-title="工资草稿未能读取" :state-description="error" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load()">
    <PayrollACommandState :pending="!!pending" :busy="busy" :error="error" @recover="ui.recover" @refresh="ui.load()" />
    <p v-if="latest" class="panel my-3 p-3 text-12px leading-5">
      已重新读取资料，原草稿与保存依据仍保留。请点击“核对完成量与单价”明确采用本次读取结果。
    </p>
    <form v-if="matchingRead" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.save">
      <PayrollAFormFields :draft="draft" :options="matchingRead.options" :ratio-default="matchingRead.ratioDefault" :disabled="!editable" :field-errors="fieldErrors" @patch="change" />
      <div class="flex flex-wrap gap-2">
        <KitButton type="button" :disabled="busy || !!pending" @click="ui.load(true)">
          核对完成量与单价
        </KitButton><NuxtLink v-if="draft.projectId && draft.month" :to="configuration" class="btn-secondary">
          工资配置
        </NuxtLink>
      </div>
      <p v-if="!previewed" class="text-12px text-warn">
        请先按当前请款范围重新核对来源，再保存草稿。
      </p>
      <PayrollASourceReview :read="matchingRead" :return-to="route.fullPath" />
      <section id="section-note" class="panel scroll-mt-4 p-4">
        <SectionHeader title="备注" /><textarea :value="draft.note" class="field-input mt-3 min-w-0 w-full" rows="3" aria-label="工资备注" :disabled="!editable" @input="ui.change({ note: ($event.target as HTMLTextAreaElement).value })" />
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
