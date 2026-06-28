<script setup lang="ts">
import type { Supplier } from '~/stores/supplier'

const route = useRoute()
const store = useSupplierStore()
const toast = useToast()

const supplierId = computed(() => route.params.id as string)
const supplier = computed(() => store.byId(supplierId.value))

const activeTab = ref('detail')
const tabs = [
  { key: 'detail', label: '详细资料' },
  { key: 'credential', label: '证照附件' },
  { key: 'projects', label: '合作项目' },
  { key: 'contracts', label: '合同汇总' },
  { key: 'payments', label: '请款/付款汇总' },
  { key: 'tickets', label: '收票汇总' },
]

const showEdit = ref(false)
const editing = ref<Partial<Supplier>>({})

function openEdit() {
  if (!supplier.value) return
  editing.value = { ...supplier.value }
  showEdit.value = true
}

async function handleSave() {
  if (!editing.value.id) return
  await store.update(editing.value.id, editing.value)
  toast.success('分供方信息已更新')
  showEdit.value = false
}

const CRED_LABEL: Record<string, string> = {
  incomplete: '资料缺失',
  reviewing: '审核中',
  qualified: '合格',
  rejected: '退回',
}
const CRED_COLOR: Record<string, string> = {
  incomplete: 'chip-warn',
  reviewing: 'chip-brand',
  qualified: 'chip-ok',
  rejected: 'chip-danger',
}

onMounted(() => store.load())
</script>

<template>
  <div v-if="supplier">
    <!-- 顶部摘要 -->
    <div class="border border-line bg-panel mb-4 px-4 py-3">
      <div class="flex items-center gap-3 mb-2">
        <NuxtLink to="/base/supplier" class="icon-btn" title="返回列表">
          <span class="i-lucide-arrow-left text-14px" />
        </NuxtLink>
        <h2 class="text-17px font-800 text-ink">{{ supplier.name }}</h2>
        <span :class="['chip', CRED_COLOR[supplier.credentialStatus]]">
          {{ CRED_LABEL[supplier.credentialStatus] || supplier.credentialStatus }}
        </span>
        <div class="flex-1" />
        <button class="btn-secondary" @click="openEdit">
          <span class="i-lucide-square-pen text-13px mr-1" /> 编辑
        </button>
      </div>
      <div class="info-row text-12px">
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">类别</div>
          <div>{{ supplier.supplierCategory || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">评价</div>
          <div>{{ supplier.rating || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">联系人</div>
          <div>{{ supplier.contact || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">电话</div>
          <div>{{ supplier.contactPhone || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">税号</div>
          <div class="font-mono text-11px">{{ supplier.taxNo || '—' }}</div>
        </div>
      </div>
    </div>

    <!-- Tab 栏 -->
    <div class="flex border-b border-line mb-4">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="content-tab"
        :class="activeTab === t.key ? 'content-tab-active' : ''"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Tab 内容 -->
    <div v-if="activeTab === 'detail'">
      <SupplierDetailTab :supplier="supplier" />
    </div>

    <div v-else-if="activeTab === 'credential'">
      <SupplierCredentialTab :supplier-id="supplier.id" />
    </div>

    <div v-else class="border border-line bg-panel p-8 text-center text-ink-faint text-13px">
      {{ tabs.find(t => t.key === activeTab)?.label }} — 待实现
    </div>

    <!-- 编辑弹窗复用列表页的表单结构 -->
    <FormDialog
      :open="showEdit"
      title="编辑分供方"
      :sections="[
        { key: 'basic', label: '基础信息' },
        { key: 'invoice', label: '开票/银行' },
        { key: 'contact', label: '联系/其他' },
      ]"
      @save="handleSave"
      @cancel="showEdit = false"
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
              <option value="材料供应商">材料供应商</option>
              <option value="劳务分包商">劳务分包商</option>
              <option value="设备供应商">设备供应商</option>
              <option value="其他">其他</option>
            </select>
          </div>
          <div>
            <label class="field-label">税号</label>
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
        </div>
      </section>

      <section id="form-section-invoice" class="mb-6">
        <h4 class="text-13px font-800 text-brand-deep mb-3">开票/银行</h4>
        <div class="grid grid-cols-2 gap-x-4 gap-y-3">
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
            <label class="field-label">主要联系人</label>
            <input v-model="editing.contact" class="field-input w-full">
          </div>
          <div>
            <label class="field-label">联系方式</label>
            <input v-model="editing.contactPhone" class="field-input w-full">
          </div>
        </div>
      </section>

      <div>
        <label class="field-label">备注</label>
        <textarea v-model="editing.note" class="field-input w-full" rows="3" />
      </div>
    </FormDialog>
  </div>

  <div v-else class="py-12 text-center text-ink-faint">
    加载中...
  </div>
</template>
