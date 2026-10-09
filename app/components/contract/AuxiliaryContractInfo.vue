<script setup lang="ts">
import type { AuxiliaryContractDTO } from '~/lib/auxiliary-contract/contract'
import type { ContractFormAttachment } from '~/lib/contract/forms'
import { auxiliaryMoney } from '~/lib/auxiliary-contract/presentation'

const props = defineProps<{ contract: AuxiliaryContractDTO, attachments: ContractFormAttachment[], projectTo: string | null, supplierTo: string | null }>()
const kind = computed(() => props.contract.kind)
</script>

<template>
  <section class="panel p-4">
    <SectionHeader title="基础信息" />
    <div class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-x-8">
      <template v-if="kind === 'other_expense'">
        <div v-for="(ref, key) in { project: contract.project, supplier: contract.supplier }" :key="key" class="flex min-w-0 gap-3 border-0 border-b border-dashed border-line py-2.5 text-13px">
          <span class="w-28 shrink-0 text-ink-soft">{{ key === 'project' ? '项目' : '乙方分供方' }}</span><NuxtLink v-if="key === 'project' ? projectTo : supplierTo" :to="(key === 'project' ? projectTo : supplierTo) ?? undefined" class="min-w-0 break-words text-brand">
            {{ ref?.state === 'resolved' ? ref.label : '' }}
          </NuxtLink><span v-else>未记录关系</span>
        </div>
      </template>
      <div v-for="(value, label) in { 合同名称: contract.draft.name, 合同编号: contract.draft.no, 类别: contract.draft.category, 甲方: contract.draft.partyA, ...(kind === 'company_expense' ? { '乙方（对方单位）': contract.draft.counterparty } : {}), 签订日期: contract.draft.signDate, 合同期: contract.draft.servicePeriod, 付款周期: contract.draft.paymentCycle, 税率: contract.draft.taxRate == null ? null : `${contract.draft.taxRate}%`, 发票类型: contract.draft.invoiceType, ...(kind === 'other_expense' ? { 结算状态: contract.settlementStatus, 结清状态: contract.clearanceStatus, 按结算应付: auxiliaryMoney(contract.amounts.bySettlementPayable) } : {}) }" :key="label" class="flex min-w-0 gap-3 border-0 border-b border-dashed border-line py-2.5 text-13px">
        <span class="w-28 shrink-0 text-ink-soft">{{ label }}</span><strong class="min-w-0 break-words font-500">{{ value || '未记录' }}</strong>
      </div>
    </div>
    <SectionHeader class="mt-5" title="合同条款" /><p class="whitespace-pre-wrap break-words text-13px">
      {{ contract.draft.content || '合同内容简述未记录' }}
    </p><p v-if="kind === 'other_expense'" class="text-12px text-ink-soft">
      履约联系人：{{ contract.draft.contactName || '未记录' }} · 联系方式：{{ contract.draft.contactPhone || '未记录' }}
    </p><p class="whitespace-pre-wrap break-words text-13px">
      {{ contract.draft.mainTerms || '未记录' }}
    </p>
    <SectionHeader class="mt-5" title="备注" /><p class="whitespace-pre-wrap break-words text-13px">
      {{ contract.draft.note || '未记录' }}
    </p>
    <SectionHeader class="mt-5" title="系统信息" /><dl class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-x-8 text-12px">
      <div v-for="(value, label) in { 负责人: contract.audit.responsible, 所属部门: contract.audit.department, 创建人: contract.audit.createdBy, 创建时间: contract.audit.createdAt, 修改人: contract.audit.updatedBy, 修改时间: contract.audit.updatedAt }" :key="label" class="flex gap-3 border-0 border-b border-dashed border-line py-2">
        <dt class="w-28 shrink-0 text-ink-soft">
          {{ label }}
        </dt><dd class="m-0 min-w-0 break-words">
          {{ value || '未记录' }}
        </dd>
      </div>
    </dl>
  </section>
  <section class="panel mt-3 p-4">
    <SectionHeader title="合同附件" /><p class="text-12px text-ink-soft">
      审批稿、签约扫描件与原协议附件按稳定目录展示；真实正文从下方合同文件读取，缺件保留原证据。
    </p><ul v-if="attachments.length" class="m-0 list-none p-0">
      <li v-for="file in attachments" :key="file.id" class="flex min-w-0 flex-wrap gap-3 border-b border-line py-2 text-13px">
        <strong class="min-w-0 break-words">{{ file.fileName }}</strong><span>{{ file.category || '合同附件' }}</span><span>{{ file.uploader || '上传人未记录' }}</span><span>{{ file.uploadedAt || '时间未记录' }}</span>
      </li>
    </ul><p v-else class="text-13px text-ink-faint">
      暂无合同附件
    </p>
  </section>
</template>
