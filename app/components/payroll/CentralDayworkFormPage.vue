<script setup lang="ts">
import type { PayrollDayworkRecordDraft } from '~/lib/payroll/central-daywork-contract'
import { computed } from 'vue'
import { usePayrollDayworkForm } from '~/composables/usePayrollDayworkForm'

const ui = usePayrollDayworkForm()
const { recordId, matching, currentRead, latest, draft, loading, error, fieldErrors, busy, editable, canSubmit, needsReview, pending, changedAfterSave, formElement } = ui
const title = computed(() => recordId.value ? '编辑签工记录' : '新增签工记录')
async function change(value: Partial<PayrollDayworkRecordDraft>) {
  ui.change(value)
  if ('projectId' in value)
    await ui.preview()
}
useTabTitle(title)
</script>

<template>
  <EntityFormShell :title="title" subtitle="保存逐日用工事实；有真实证明信息时可明确保存并确认。" :sections="[{ key: 'record', label: '用工事实' }, { key: 'confirm', label: '证明与确认' }]" :state="!matching ? loading ? 'loading' : 'error' : 'ready'" state-title="签工未能读取" :state-description="ui.readError.value || error" state-action-label="重新读取" @state-action="ui.load()" @back="ui.leave">
    <PayrollACommandState :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error || ui.readError.value" @recover="ui.recover" @refresh="ui.load()" />
    <section v-if="needsReview && !changedAfterSave" class="panel mb-3 grid gap-2 p-3 text-12px">
      <p>当前资料或权限已有变化，原输入和保存依据仍保留。请重新核对本稿后再提交。</p>
      <p v-if="currentRead?.record">
        当前原记录：{{ currentRead.record.workerName || '姓名未记录' }} · {{ currentRead.record.workDate }} · {{ currentRead.record.workContent || '施工内容未记录' }}
      </p>
      <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.load()">
        按当前资料重新核对本稿
      </KitButton>
    </section>
    <section v-if="changedAfterSave && latest?.record" class="panel mb-3 grid gap-2 p-3 text-12px" aria-label="原提交后续更新">
      <p>原提交已完成，记录随后有更新。当前原记录：{{ latest.record.workerName || '姓名未记录' }} · {{ latest.record.workDate }}；本页原输入仍保留。</p>
      <details class="rounded border border-line p-3">
        <summary class="cursor-pointer font-700">
          查看当前原记录
        </summary><dl class="mt-3 grid gap-2 sm:grid-cols-2">
          <div><dt>当前日期与时段</dt><dd>{{ latest.record.workDate }} · {{ latest.record.startTime }}—{{ latest.record.endTime }}</dd></div><div><dt>当前工数与状态</dt><dd>{{ latest.record.laborUnits ?? '未记录' }} 工 · {{ latest.record.status === 'confirmed' ? '已确认' : latest.record.status === 'draft' ? '待确认' : latest.record.status || '未记录' }}</dd></div><div class="sm:col-span-2">
            <dt>当前施工内容</dt><dd class="whitespace-pre-wrap break-words">
              {{ latest.record.workContent || '未记录' }}
            </dd>
          </div><div><dt>当前证明人</dt><dd>{{ latest.record.witness || '未记录' }}</dd></div><div><dt>当前确认日期</dt><dd>{{ latest.record.confirmedOn || '未记录' }}</dd></div>
        </dl><p class="mt-3">
          以上为随后更新的原记录，下面保留本次原输入。返回台账后可重新打开编辑当前记录。
        </p>
      </details>
    </section>
    <p v-for="reason in currentRead?.eligibility.reasons || []" :key="reason" class="mb-3 text-12px leading-5 text-warn">
      {{ reason }}
    </p>
    <form v-if="matching" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.save(draft.status)">
      <PayrollDayworkFormFields :draft="draft" :options="matching.options" :disabled="!editable" :errors="fieldErrors" @patch="change" />
    </form>
    <details v-if="matching?.record" class="panel mt-4 p-3 text-12px">
      <summary>原记录与诊断</summary><p v-for="(item, index) in matching.diagnostics" :key="index" class="mt-2 text-warn">
        {{ item.message }}
      </p><pre class="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all">{{ JSON.stringify(matching.record.original, null, 2) }}</pre>
    </details>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.leave">
          返回
        </KitButton><KitButton :disabled="!canSubmit" @click="ui.save('draft')">
          保存待确认
        </KitButton><KitButton variant="primary" :disabled="!canSubmit" @click="ui.save('confirmed')">
          保存并确认
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
