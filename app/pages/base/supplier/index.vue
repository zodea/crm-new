<script setup lang="ts">
import type { Supplier } from '~/stores/supplier'

const store = useSupplierStore()
const toast = useToast()

const searchText = ref('')
const showForm = ref(false)
const editing = ref<Partial<Supplier>>({})
const isEditing = ref(false)

const CATEGORY_OPTIONS = ['材料供应商', '劳务分包商', '设备供应商', '其他']
const CRED_STATUS_COLOR: Record<string, string> = {
  incomplete: 'cell--status-warn',
  reviewing: 'text-brand font-600',
  qualified: 'cell--status-ok',
  rejected: 'cell--status-danger',
}
const CRED_STATUS_LABEL: Record<string, string> = {
  incomplete: '资料缺失',
  reviewing: '审核中',
  qualified: '合格',
  rejected: '退回',
}

const filtered = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  if (!q) return store.list
  return store.list.filter(s =>
    s.name.toLowerCase().includes(q)
    || s.contact.toLowerCase().includes(q)
    || s.taxNo.toLowerCase().includes(q)
    || s.supplierCategory.toLowerCase().includes(q),
  )
})

function openCreate() {
  editing.value = { supplierCategory: '材料供应商' }
  isEditing.value = false
  showForm.value = true
}

function openEdit(row: Supplier) {
  editing.value = { ...row }
  isEditing.value = true
  showForm.value = true
}

async function handleSave() {
  if (!editing.value.name?.trim()) {
    toast.warning('请填写公司全称')
    return
  }
  if (isEditing.value && editing.value.id) {
    await store.update(editing.value.id, editing.value)
    toast.success('分供方已更新')
  }
  else {
    await store.add(editing.value)
    toast.success('分供方已创建')
  }
  showForm.value = false
}

async function handleDelete(row: Supplier) {
  await store.remove(row.id)
  toast.success('已删除')
}

onMounted(() => store.load())
</script>

<template>
  <div>
    <DataListToolbar
      title="分供方"
      :count="filtered.length"
      @search="v => searchText = v"
      @create="openCreate"
    />

    <div class="border border-line">
      <vxe-table
        :data="filtered"
        :loading="store.loading"
        border
        show-overflow
        height="auto"
        :row-config="{ isHover: true }"
        :column-config="{ resizable: true }"
      >
        <vxe-column type="seq" title="#" width="52" fixed="left" />
        <vxe-column field="name" title="分供方名称" min-width="180" fixed="left">
          <template #default="{ row }">
            <NuxtLink :to="`/base/supplier/${row.id}`" class="cell--link">
              {{ row.name }}
            </NuxtLink>
          </template>
        </vxe-column>
        <vxe-column field="supplierCategory" title="分供方类别" width="110" />
        <vxe-column field="taxNo" title="税号" width="180" />
        <vxe-column field="aliases" title="简称" width="100">
          <template #default="{ row }">
            {{ row.aliases?.[0] ?? '' }}
          </template>
        </vxe-column>
        <vxe-column field="address" title="详细地址" min-width="150" />
        <vxe-column field="contact" title="主要联系人" width="100" />
        <vxe-column field="contactPhone" title="联系方式" width="120" />
        <vxe-column field="credentialStatus" title="资料状态" width="90">
          <template #default="{ row }">
            <span :class="CRED_STATUS_COLOR[row.credentialStatus] || ''">
              {{ CRED_STATUS_LABEL[row.credentialStatus] || row.credentialStatus }}
            </span>
          </template>
        </vxe-column>
        <vxe-column title="操作" width="120" fixed="right">
          <template #default="{ row }">
            <div class="flex items-center gap-1">
              <NuxtLink :to="`/base/supplier/${row.id}`" class="icon-btn" title="详情">
                <span class="i-lucide-file-text text-14px" />
              </NuxtLink>
              <button class="icon-btn" title="编辑" @click="openEdit(row)">
                <span class="i-lucide-square-pen text-14px" />
              </button>
              <button class="icon-btn-danger" title="删除" @click="handleDelete(row)">
                <span class="i-lucide-trash-2 text-14px" />
              </button>
            </div>
          </template>
        </vxe-column>
      </vxe-table>
    </div>

    <!-- 新增/编辑弹窗 -->
    <FormDialog
      :open="showForm"
      :title="isEditing ? '编辑分供方' : '新增分供方'"
      :sections="[
        { key: 'basic', label: '基础信息' },
        { key: 'invoice', label: '开票/银行' },
        { key: 'contact', label: '联系/其他' },
      ]"
      @save="handleSave"
      @cancel="showForm = false"
    >
      <section id="form-section-basic" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">基础信息</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div class="col-span-2">
            <label class="field-label">公司全称 *</label>
            <input v-model="editing.name" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">分供方类别</label>
            <select v-model="editing.supplierCategory" class="field-input w-full">
              <option v-for="c in CATEGORY_OPTIONS" :key="c" :value="c">{{ c }}</option>
            </select>
          </div>
          <div>
            <label class="field-label">统一社会信用代码/税号</label>
            <input v-model="editing.taxNo" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">法定代表人</label>
            <input v-model="editing.legalRep" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">注册资金 (万元)</label>
            <input v-model.number="editing.registeredCapital" type="number" class="field-input w-full">
          </div>
          <div class="col-span-2">
            <label class="field-label">注册地址</label>
            <input v-model="editing.address" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">主营业务</label>
            <input v-model="editing.mainBusiness" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">业务类型</label>
            <input v-model="editing.businessType" class="field-input w-full">
          </div>
        </div>
      </section>

      <section id="form-section-invoice" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">开票/银行</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="field-label">开票名称</label>
            <input v-model="editing.invoiceName" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">纳税人类型</label>
            <input v-model="editing.taxpayerType" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">开户行</label>
            <input v-model="editing.bank" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">银行账号</label>
            <input v-model="editing.bankAccount" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">开票地址</label>
            <input v-model="editing.invoiceAddress" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">电话</label>
            <input v-model="editing.phone" class="field-input w-full">
          </div>
        </div>
      </section>

      <section id="form-section-contact" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">联系/其他</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
          <div>
            <label class="field-label">主要联系人 (签约代表)</label>
            <input v-model="editing.contact" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">联系方式</label>
            <input v-model="editing.contactPhone" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">评价等级</label>
            <input v-model="editing.rating" class="field-input w-full">
          </div>
        </div>
      </section>

      <div>
        <label class="field-label">备注</label>
        <textarea v-model="editing.note" class="field-input w-full" rows="3" />
      </div>
    </FormDialog>
  </div>
</template>
