<script setup lang="ts">
import type { ReadOnlyField } from '~/components/ui/ReadOnlySection.vue'
import type { SupplierListSourceRow } from '~/lib/supplier/repository'
import { computed } from 'vue'

const props = defineProps<{ supplier: SupplierListSourceRow }>()

const sections = computed<Array<{ title: string, fields: ReadOnlyField[] }>>(() => [
  {
    title: '基础信息',
    fields: [
      { label: '分供方名称', value: props.supplier.name },
      { label: '简称', value: props.supplier.aliases?.join('、') },
      { label: '分供方类别', value: props.supplier.supplierCategory },
      { label: '评价等级', value: props.supplier.rating },
      { label: '法定代表人', value: props.supplier.legalRep },
      { label: '注册资金（万元）', value: props.supplier.registeredCapital, numeric: true },
      { label: '注册日期', value: props.supplier.registeredDate },
      { label: '统一社会信用代码', value: props.supplier.taxNo },
      { label: '主营业务', value: props.supplier.mainBusiness },
      { label: '注册地址', value: props.supplier.address, wide: true },
      { label: '备注', value: props.supplier.note, wide: true },
    ],
  },
  {
    title: '联系人信息',
    fields: [
      { label: '主要联系人', value: props.supplier.contact },
      { label: '联系电话', value: props.supplier.contactPhone },
      { label: '联系人职务', value: props.supplier.contactTitle },
    ],
  },
  {
    title: '开票信息',
    fields: [
      { label: '开票名称', value: props.supplier.invoiceName },
      { label: '开户银行', value: props.supplier.bank },
      { label: '银行账号', value: props.supplier.bankAccount },
      { label: '纳税人类型', value: props.supplier.taxpayerType },
      { label: '开票地址', value: props.supplier.invoiceAddress },
      { label: '电话', value: props.supplier.phone },
    ],
  },
])
</script>

<template>
  <div class="grid min-w-0 gap-2">
    <ReadOnlySection v-for="section in sections" :key="section.title" :title="section.title" :fields="section.fields" />
  </div>
</template>
