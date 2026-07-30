<script setup lang="ts">
import type { Supplier } from '~/stores/supplier'
import { maskBankAccount, maskIdentifier, maskPhone } from '~/lib/util/privacy'

defineProps<{
  supplier: Supplier
}>()

interface FieldDef {
  label: string
  key: keyof Supplier
  mono?: boolean
  privacy?: 'identifier' | 'phone' | 'bank'
  span?: number
}

const basicFields: FieldDef[] = [
  { label: '公司全称', key: 'name', span: 3 },
  { label: '简称/别名', key: 'aliases', span: 2 },
  { label: '分供方类别', key: 'supplierCategory' },
  { label: '业务类型', key: 'businessType' },
  { label: '评价等级', key: 'rating' },
  { label: '统一社会信用代码', key: 'uniqueCode', mono: true, privacy: 'identifier' },
  { label: '税号', key: 'taxNo', mono: true, privacy: 'identifier' },
  { label: '法定代表人', key: 'legalRep' },
  { label: '注册资金', key: 'registeredCapital' },
  { label: '注册日期', key: 'registeredDate' },
  { label: '注册地址', key: 'address', span: 2 },
  { label: '纳税人类型', key: 'taxpayerType' },
  { label: '主营业务', key: 'mainBusiness', span: 3 },
]

const invoiceFields: FieldDef[] = [
  { label: '开票名称', key: 'invoiceName' },
  { label: '纳税人类型', key: 'taxpayerType' },
  { label: '电话', key: 'phone', privacy: 'phone' },
  { label: '开户行', key: 'bank' },
  { label: '银行账号', key: 'bankAccount', mono: true, privacy: 'bank' },
  { label: '开票地址', key: 'invoiceAddress' },
]

const contactFields: FieldDef[] = [
  { label: '主要联系人(签约代表)', key: 'contact' },
  { label: '联系方式', key: 'contactPhone', privacy: 'phone' },
  { label: '职务', key: 'contactTitle' },
]

function display(supplier: Supplier, field: FieldDef): string {
  const val = supplier[field.key]
  if (val == null || val === '')
    return '—'
  if (typeof val === 'string' && field.privacy === 'identifier')
    return maskIdentifier(val)
  if (typeof val === 'string' && field.privacy === 'phone')
    return maskPhone(val)
  if (typeof val === 'string' && field.privacy === 'bank')
    return maskBankAccount(val)
  if (typeof val === 'number')
    return val.toLocaleString()
  if (Array.isArray(val))
    return val.join('、') || '—'
  return String(val)
}
</script>

<template>
  <div>
    <!-- 基础信息 -->
    <h4 class="section-heading mb-2 text-13px font-700 text-ink">
      <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
      基础信息
    </h4>
    <div class="form-grid mb-5">
      <div
        v-for="f in basicFields"
        :key="f.key"
        class="form-cell"
        :data-form-span="f.span || undefined"
      >
        <span class="text-9px text-ink-faint">{{ f.label }}</span>
        <span class="text-12px" :class="f.mono ? 'font-mono' : ''">
          {{ display(supplier, f) }}
        </span>
      </div>
    </div>

    <!-- 开票/银行信息 -->
    <h4 class="section-heading mb-2 text-13px font-700 text-ink">
      <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
      开票/银行信息
    </h4>
    <div class="form-grid mb-5">
      <div
        v-for="f in invoiceFields"
        :key="f.key"
        class="form-cell"
      >
        <span class="text-9px text-ink-faint">{{ f.label }}</span>
        <span class="text-12px" :class="f.mono ? 'font-mono' : ''">
          {{ display(supplier, f) }}
        </span>
      </div>
    </div>

    <!-- 联系人信息 -->
    <h4 class="section-heading mb-2 text-13px font-700 text-ink">
      <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
      联系人信息
    </h4>
    <div class="form-grid mb-5">
      <div
        v-for="f in contactFields"
        :key="f.key"
        class="form-cell"
      >
        <span class="text-9px text-ink-faint">{{ f.label }}</span>
        <span class="text-12px">{{ display(supplier, f) }}</span>
      </div>
    </div>

    <!-- 系统信息 -->
    <h4 class="section-heading mb-2 text-13px font-700 text-ink">
      <span aria-hidden="true" class="h-3.5 w-[3px] flex-none rounded-[1px] bg-brand" />
      系统信息
    </h4>
    <div class="form-grid">
      <div class="form-cell">
        <span class="text-9px text-ink-faint">创建时间</span>
        <span class="text-12px">{{ supplier.createdAt?.slice(0, 19).replace('T', ' ') || '—' }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">更新时间</span>
        <span class="text-12px">{{ supplier.updatedAt?.slice(0, 19).replace('T', ' ') || '—' }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">来源</span>
        <span class="text-12px">{{ supplier.source || '—' }}</span>
      </div>
      <div class="form-cell">
        <span class="text-9px text-ink-faint">备注</span>
        <span class="text-12px">{{ supplier.note || '—' }}</span>
      </div>
    </div>
  </div>
</template>
