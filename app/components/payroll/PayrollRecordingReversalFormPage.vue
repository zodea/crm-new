<script setup lang="ts">
import { computed } from 'vue'
import PayrollACommandState from '~/components/payroll/PayrollACommandState.vue'
import PayrollOriginalWageSummary from '~/components/payroll/PayrollOriginalWageSummary.vue'
import { usePayrollRecordingReversalForm } from '~/composables/usePayrollActualPaymentForm'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const route = useRoute()
const ui = usePayrollRecordingReversalForm()
const { read, latest, draft, loading, busy, error, pending, editable, previewed, canConfirm, formElement, errorPanel } = ui
const correctingReversal = computed(() => read.value?.originalFact.kind === 'recording-reversal')
const title = computed(() => correctingReversal.value ? '纠正工资错记冲销' : '工资错记冲销')
useTabTitle(title)
</script>

<template>
  <EntityFormShell :title="title" :subtitle="correctingReversal ? '核实原冲销有误后引用该记录追加独立纠错，原记录继续保留。' : '核实某笔登记未真实发生后追加冲销。不能把实际已付的核减当成错记。'" back-label="返回来源" :sections="[{ key: 'original', label: '原事实' }, { key: 'proof', label: '核对依据' }]" :state="!read ? loading ? 'loading' : 'error' : 'ready'" state-title="原收付事实未能核实" :state-description="error" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load()">
    <PayrollACommandState ref="errorPanel" focusable :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.execute('recover')" @refresh="ui.load()" />
    <p v-if="latest" class="panel my-3 p-3 text-12px">
      原依据仍保留，请核对新读取的资格后继续。
    </p>
    <form v-if="read && draft" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.load(true)">
      <PayrollOriginalWageSummary v-for="(original, originalIndex) in read.originals" :key="original.statementId" :section-id="originalIndex === 0 ? 'section-original' : undefined" :original="original" :return-to="route.fullPath" />
      <section id="section-proof" class="panel grid min-w-0 gap-3 p-4">
        <SectionHeader title="具体错记事实与核实依据" />
        <p class="text-12px">
          原登记实额 {{ payrollAmount(read.originalFact.signedAmount.value) }}；本次冲销登记效果 {{ payrollAmount(read.reversalAmount.value) }}。
        </p>
        <p class="text-12px text-warn">
          {{ correctingReversal ? '本次仅纠正被引用冲销的登记效果，不代表新的实际补发或退款；原冲销及原签名金额继续保留。' : '本次不是工人实际退款；原记录及原签名金额继续保留。' }}
        </p>
        <label class="grid gap-1 text-12px">核实日期<input :value="draft.confirmedOn" type="date" class="field-input max-w-md" :disabled="!editable" @input="ui.change({ ...draft, confirmedOn: ($event.target as HTMLInputElement).value })"></label>
        <label class="grid gap-1 text-12px">{{ correctingReversal ? '纠正原冲销的核对依据' : '确认未发生的核对依据' }}<textarea :value="draft.evidenceNote" rows="4" class="field-input" :disabled="!editable" @input="ui.change({ ...draft, evidenceNote: ($event.target as HTMLTextAreaElement).value })" /></label>
        <label class="flex items-start gap-2 text-12px"><input :checked="draft.confirmedNotOccurred" type="checkbox" class="mt-0.5" :disabled="!editable" @change="ui.change({ ...draft, confirmedNotOccurred: ($event.target as HTMLInputElement).checked })"><span>{{ correctingReversal ? '已核实这次冲销所称的事实不成立，需引用该冲销追加纠错，并保留可回读依据。' : '已核实这笔登记的收付未真实发生，并保留可回读的核对依据。' }}</span></label>
        <KitButton type="button" class="w-fit" :disabled="busy || !!pending" @click="ui.load(true)">
          核对错记事实与处理关系
        </KitButton>
        <p v-if="!previewed" class="text-12px text-warn">
          依据已修改，请重新核对。
        </p><p v-for="reason in read.eligibility.reasons" :key="reason" role="alert" tabindex="-1" class="text-12px text-warn">
          {{ reason }}
        </p>
      </section>
    </form>
    <template #footer>
      <div class="flex flex-wrap justify-end gap-2">
        <KitButton variant="secondary" :disabled="busy || !!pending" @click="ui.leave">
          返回来源
        </KitButton><KitButton variant="primary" :disabled="!canConfirm" @click="ui.execute('confirm')">
          {{ correctingReversal ? '确认冲销纠错' : '确认错记冲销' }}
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
