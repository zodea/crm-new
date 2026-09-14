<script setup lang="ts">
import { usePayrollActualPaymentForm } from '~/composables/usePayrollActualPaymentForm'

const route = useRoute()
const ui = usePayrollActualPaymentForm()
const { read, latest, draft, loading, busy, error, pending, editable, previewed, canConfirm, formElement, errorPanel } = ui
useTabTitle('登记工资实际补退')
</script>

<template>
  <EntityFormShell title="登记工资实际补退" subtitle="仅登记已经真实发生的补发或退款。差额与实际发生金额分别核对。" back-label="返回来源" :sections="[{ key: 'original', label: '原工资' }, { key: 'payment', label: '实际收付' }, { key: 'allocation', label: '收付成员' }, { key: 'application', label: '处理更正' }]" :state="!read ? loading ? 'loading' : 'error' : 'ready'" state-title="实际补退资料未能读取" :state-description="error" state-action-label="重新读取" @back="ui.leave" @state-action="ui.load()">
    <PayrollACommandState ref="errorPanel" focusable :pending="!!pending" :awaiting-read="pending?.state === 'awaiting-read'" :busy="busy" :error="error" @recover="ui.execute('recover')" @refresh="ui.load()" />
    <p v-if="latest" class="panel my-3 p-3 text-12px">
      已取得当前资格，原金额与采用余额仍保留。请重新核对本稿后再确认。
    </p>
    <form v-if="read && draft" ref="formElement" class="grid min-w-0 gap-4" @submit.prevent="ui.load(true)">
      <PayrollOriginalWageSummary v-for="(original, originalIndex) in read.originals" :key="original.statementId" :section-id="originalIndex === 0 ? 'section-original' : undefined" :original="original" :return-to="route.fullPath" />
      <PayrollActualPaymentFields :read="read" :draft="draft" :disabled="!editable" @change="ui.change" />
      <section class="panel grid gap-3 p-4">
        <KitButton type="button" class="w-fit" :disabled="busy || !!pending" @click="ui.load(true)">
          核对本次金额与剩余
        </KitButton><p v-if="!previewed" class="text-12px text-warn">
          输入已修改，请按当前资料重新核对。
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
          确认真实收付
        </KitButton>
      </div>
    </template>
  </EntityFormShell>
</template>
