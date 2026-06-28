<script setup lang="ts">
import type { Supplier } from '~/stores/supplier'

defineProps<{
  supplier: Supplier
}>()

interface FieldDef {
  label: string
  key: keyof Supplier
  mono?: boolean
  span?: number
}

const basicFields: FieldDef[] = [
  { label: '公司全称', key: 'name', span: 3 },
  { label: '分供方类别', key: 'supplierCategory' },
  { label: '业务类型', key: 'businessType' },
  { label: '评价等级', key: 'rating' },
  { label: '统一社会信用代码', key: 'taxNo', mono: true },
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
  { label: '电话', key: 'phone' },
  { label: '开户行', key: 'bank' },
  { label: '银行账号', key: 'bankAccount', mono: true },
  { label: '开票地址', key: 'invoiceAddress' },
]

const contactFields: FieldDef[] = [
  { label: '主要联系人(签约代表)', key: 'contact' },
  { label: '联系方式', key: 'contactPhone' },
  { label: '来源', key: 'source' },
]

function display(supplier: Supplier, key: keyof Supplier): string {
  const val = supplier[key]
  if (val == null || val === '') return '—'
  if (typeof val === 'number') return val.toLocaleString()
  if (Array.isArray(val)) return val.join('、') || '—'
  return String(val)
}
</script>

<template>
  <div>
    <!-- 基础信息 -->
    <h4 class="text-13px font-700 text-ink mb-2 flex items-center gap-1.5">
      <span class="w-0.5 h-3.5 bg-brand rounded-full" />
      基础信息
    </h4>
    <div class="form-grid mb-5">
      <div
        v-for="f in basicFields"
        :key="f.key"
        class="form-cell"
        :style="f.span ? { gridColumn: `span ${f.span}` } : {}"
      >
        <span class="text-9px text-ink-faint">{{ f.label }}</span>
        <span class="text-12px" :class="f.mono ? 'font-mono' : ''">
          {{ display(supplier, f.key) }}
        </span>
      </div>
    </div>

    <!-- 开票/银行信息 -->
    <h4 class="text-13px font-700 text-ink mb-2 flex items-center gap-1.5">
      <span class="w-0.5 h-3.5 bg-brand rounded-full" />
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
          {{ display(supplier, f.key) }}
        </span>
      </div>
    </div>

    <!-- 联系人信息 -->
    <h4 class="text-13px font-700 text-ink mb-2 flex items-center gap-1.5">
      <span class="w-0.5 h-3.5 bg-brand rounded-full" />
      联系人信息
    </h4>
    <div class="form-grid mb-5">
      <div
        v-for="f in contactFields"
        :key="f.key"
        class="form-cell"
      >
        <span class="text-9px text-ink-faint">{{ f.label }}</span>
        <span class="text-12px">{{ display(supplier, f.key) }}</span>
      </div>
    </div>

    <!-- 系统信息 -->
    <h4 class="text-13px font-700 text-ink mb-2 flex items-center gap-1.5">
      <span class="w-0.5 h-3.5 bg-brand rounded-full" />
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
        <span class="text-9px text-ink-faint">备注</span>
        <span class="text-12px">{{ supplier.note || '—' }}</span>
      </div>
    </div>
  </div>
</template>
