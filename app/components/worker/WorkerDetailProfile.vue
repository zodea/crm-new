<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { WorkerDetail } from '~/lib/worker/detail'
import { formatMoney } from '~/lib/util/money'
import { maskBankAccount, maskIdentifier, maskPhone } from '~/lib/util/privacy'
import { workerPresenceStatusLabel, workerRecordStatusLabel } from '~/lib/worker/detail'

defineProps<{
  detail: DeepReadonly<WorkerDetail>
}>()

function display(value: string | number | null): string {
  return value === '' || value == null ? '—' : String(value)
}

function money(value: number): string {
  return formatMoney(value, { currency: true })
}

function privateValue(value: string, masker: (input: string) => string): string {
  return display(masker(value))
}

function maskContactName(value: string): string {
  const name = value.trim()
  if (!name)
    return ''
  if (name.length === 1)
    return '*'
  return `${name.slice(0, 1)}${'*'.repeat(Math.min(name.length - 1, 2))}`
}
</script>

<template>
  <section class="panel min-w-0 p-4" data-testid="worker-profile">
    <SectionHeader title="个人主数据" subtitle="身份、联系方式与用工基础信息" />
    <dl class="detail-grid">
      <div><dt>姓名</dt><dd>{{ detail.worker.name }}</dd></div>
      <div><dt>性别</dt><dd>{{ display(detail.worker.gender) }}</dd></div>
      <div><dt>身份证号</dt><dd>{{ privateValue(detail.worker.idCard, maskIdentifier) }}</dd></div>
      <div><dt>联系电话</dt><dd>{{ privateValue(detail.worker.phone, maskPhone) }}</dd></div>
      <div><dt>籍贯</dt><dd>{{ display(detail.worker.hometown) }}</dd></div>
      <div><dt>紧急联系人</dt><dd>{{ display(maskContactName(detail.worker.emergencyContact)) }}</dd></div>
      <div><dt>紧急电话</dt><dd>{{ privateValue(detail.worker.emergencyPhone, maskPhone) }}</dd></div>
      <div><dt>所属班组</dt><dd>{{ detail.crew?.name || '未加入班组' }}</dd></div>
      <div><dt>档案状态</dt><dd>{{ workerRecordStatusLabel(detail.worker.status) }}</dd></div>
      <div><dt>在场状态</dt><dd>{{ workerPresenceStatusLabel(detail.worker.projectStatus) }}</dd></div>
      <div><dt>主工种</dt><dd>{{ display(detail.worker.trade) }}</dd></div>
      <div><dt>技能等级</dt><dd>{{ display(detail.worker.skillLevel) }}</dd></div>
      <div><dt>日工资参考</dt><dd>{{ detail.worker.dailyWage == null ? '—' : money(detail.worker.dailyWage) }}</dd></div>
      <div><dt>进 / 退场</dt><dd>{{ display(detail.worker.entryDate) }} / {{ display(detail.worker.exitDate) }}</dd></div>
      <div><dt>安全教育</dt><dd>{{ detail.worker.safetyEducation ? '已完成' : '未记录' }}</dd></div>
      <div><dt>开户行</dt><dd>{{ display(detail.worker.bankName) }}</dd></div>
      <div><dt>银行账号</dt><dd>{{ privateValue(detail.worker.bankAccount, maskBankAccount) }}</dd></div>
      <div><dt>备注</dt><dd>{{ display(detail.worker.note) }}</dd></div>
    </dl>

    <h3 class="m-0 mt-4 border-t border-line pt-4 text-13px font-700 text-ink">
      可做工种与活项
    </h3>
    <div class="flex flex-wrap gap-1.5">
      <span v-for="trade in detail.capabilities.trades" :key="`trade-${trade}`" class="status-chip">{{ trade }}</span>
      <span v-for="item in detail.capabilities.itemNames" :key="`item-${item}`" class="status-chip bg-brand-soft text-brand">{{ item }}</span>
      <span v-if="!detail.capabilities.trades.length && !detail.capabilities.itemNames.length" class="text-12px text-ink-faint">尚未配置</span>
    </div>

    <h3 class="m-0 mt-4 border-t border-line pt-4 text-13px font-700 text-ink">
      证照与附件
    </h3>
    <ul v-if="detail.attachments.length" class="m-0 grid list-none gap-2 p-0">
      <li v-for="file in detail.attachments" :key="file.id" class="flex min-w-0 items-center gap-2 rounded border border-line px-3 py-2">
        <span class="i-lucide-paperclip shrink-0 text-ink-faint" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-12px">{{ file.fileName }}</span>
        <span class="text-10px text-ink-faint">{{ file.category || '未分类' }}</span>
      </li>
    </ul>
    <p v-else class="m-0 mt-2 text-12px text-ink-faint">
      暂无证照或附件。
    </p>
  </section>
</template>

<style scoped>
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
.detail-grid > div { min-width: 0; padding: .65rem .75rem; border-bottom: 1px solid var(--line); }
dt { color: var(--ink-faint); font-size: 11px; }
dd { margin: .25rem 0 0; overflow-wrap: anywhere; font-size: 12px; font-weight: 600; }
</style>
