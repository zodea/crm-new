<script setup lang="ts">
import { usePayrollAdjustmentForm } from '~/composables/usePayrollAdjustmentForm'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const route = useRoute()
const ui = usePayrollAdjustmentForm()
const { read, latest, draft, loading, busy, error, pending, editable, previewed, canSave, canConfirm, formElement, errorPanel } = ui
useTabTitle('独立工资更正')
</script>

<template>
  <EntityFormShell title="独立工资更正" subtitle="保存更正依据后单独确认核算差额；实际补发或退款另行登记。" back-label="返回来源" :sections="[{ key: 'original', label: '原工资' }, { key: 'basis', label: '更正依据' }, { key: 'reason', label: '原因与核对' }]" :state="!read ? loading ? 'loading' : 'error' : 'ready'" state-title="更正资料未能读取" :state-description="error" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load()">
    <PayrollACommandState ref="errorPanel" focusable :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.execute('recover')" @refresh="ui.load()" />
    <p v-if="latest" class="panel my-3 p-3 text-12px">
      当前资格已重新读取，原稿及采用依据保留。请明确重新核对后继续。
    </p>
    <form v-if="read && draft" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.execute('save')">
      <PayrollOriginalWageSummary section-id="section-original" :original="read.original" :return-to="route.fullPath" />
      <details class="panel min-w-0 p-4 text-12px">
        <summary class="cursor-pointer font-700">
          查看更正前的完整依据
        </summary><PayrollAdjustmentBasisFields :basis="read.preview.before" :original="read.original" disabled />
      </details>
      <PayrollAdjustmentBasisFields section-id="section-basis" :basis="draft.basis" :original="read.original" :disabled="!editable" @change="ui.change({ ...draft, basis: $event })" />
      <section id="section-reason" class="panel grid min-w-0 gap-3 p-4">
        <SectionHeader title="原因与核对" />
        <label class="grid gap-1 text-12px">更正原因<textarea :value="draft.reason" rows="2" class="field-input" :disabled="!editable" @input="ui.change({ ...draft, reason: ($event.target as HTMLTextAreaElement).value })" /></label>
        <label class="grid gap-1 text-12px">人工核对依据<textarea :value="draft.evidenceNote" rows="3" class="field-input" :disabled="!editable" @input="ui.change({ ...draft, evidenceNote: ($event.target as HTMLTextAreaElement).value })" /></label>
        <p v-if="draft.correctsAdjustmentId" class="break-all text-12px">
          本次续更正关联：{{ draft.correctsAdjustmentId }}
        </p>
        <KitButton type="button" class="w-fit" :disabled="busy || !!pending" @click="ui.load(true)">
          按当前资料核对本稿
        </KitButton>
        <p v-if="!previewed" class="text-12px text-warn">
          输入已修改，请重新核对后保存。
        </p>
        <dl class="grid grid-cols-1 gap-3 text-12px sm:grid-cols-2">
          <div>
            <dt>更正前核算</dt><dd class="mt-1 font-mono">
              {{ payrollAmount(read.preview.beforeAmount.value) }}
            </dd>
          </div><div>
            <dt>更正后核算</dt><dd class="mt-1 font-mono">
              {{ payrollAmount(read.preview.afterAmount.value) }}
            </dd>
          </div><div>
            <dt>本次有符号差额</dt><dd class="mt-1 font-mono font-700">
              {{ payrollAmount(read.preview.delta.value) }}
            </dd>
          </div><div>
            <dt>实际收付</dt><dd class="mt-1">
              尚未发生；由独立处理记录确认
            </dd>
          </div>
        </dl>
        <p v-for="reason in [...new Set([...read.preview.reasons, ...read.eligibility.reasons])]" :key="reason" role="alert" tabindex="-1" class="break-words text-12px text-warn">
          {{ reason }}
        </p>
        <p v-if="read.status === 'confirmed'" class="text-12px">
          这项更正已确认，不能覆盖。需要再纠错时请从详情追加独立更正。
        </p>
      </section>
    </form>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.leave">
          返回来源
        </KitButton><KitButton :disabled="!canSave" @click="ui.execute('save')">
          保存更正草稿
        </KitButton><KitButton variant="primary" :disabled="!canConfirm" @click="ui.execute('confirm')">
          确认核算更正
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
