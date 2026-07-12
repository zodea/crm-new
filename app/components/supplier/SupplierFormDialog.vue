<script setup lang="ts">
import type { Supplier } from '~/stores/supplier'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'

// 分供方新增/编辑共享表单（#89 消除列表/详情两套表单的字段漂移）。
// 列表页与详情页共用同一份：v-model:open 控开关，supplier=null 为新增、传行为编辑。
// 底座 FormDialog（reka-ui Dialog，#86 宽限窗口已就位）。保存走 store，store 内部 load() 刷新共享
// 状态，两页计算属性自动联动，故无需 emit 回调（对称 ProjectFormDialog）。
const props = defineProps<{
  supplier?: Supplier | null
}>()

const open = defineModel<boolean>('open', { required: true })

const store = useSupplierStore()
const { success, warning, error } = useKitUI()

const isEditing = computed(() => !!props.supplier?.id)
const draft = ref<Partial<Supplier>>({})
// aliases（简称/别名）在 store 内是字符串数组，表单用逗号分隔文本框录入，保存时再解析回数组。
const aliasesText = ref('')

// 打开时按来源初始化草稿：编辑回填现值、新增给默认状态。
// 同时监听 supplier：详情/列表切换编辑对象（open 保持 true）也按新行重填。
watch([open, () => props.supplier], ([isOpen]) => {
  if (!isOpen)
    return
  draft.value = props.supplier ? { ...props.supplier } : { supplierCategory: '材料供应商' }
  aliasesText.value = (draft.value.aliases ?? []).join(', ')
})

async function handleSave() {
  const data = draft.value
  if (!data.name?.trim()) {
    warning('请填写公司全称')
    return
  }
  data.aliases = aliasesText.value.split(',').map(s => s.trim()).filter(Boolean)

  if (isEditing.value && data.id) {
    const logId = await store.update(data.id, data)
    if (!logId) {
      error('分供方不存在或已删除，保存失败')
      return
    }
    success('分供方信息已更新')
  }
  else {
    await store.add(data)
    success('分供方已创建')
  }
  open.value = false
}
</script>

<template>
  <FormDialog
    :open="open"
    :title="isEditing ? '编辑分供方' : '新增分供方'"
    :sections="[
      { key: 'basic', label: '基础信息' },
      { key: 'invoice', label: '开票/银行' },
      { key: 'contact', label: '联系/其他' },
    ]"
    @save="handleSave"
    @cancel="open = false"
  >
    <!-- 基础信息 -->
    <section id="form-section-basic" class="mb-6">
      <h4 class="text-13px font-800 text-brand-deep mb-3">
        基础信息
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div class="col-span-2">
          <label class="field-label">公司全称 *</label>
          <input v-model="draft.name" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">分供方类别</label>
          <select v-model="draft.supplierCategory" class="field-input w-full">
            <option v-for="c in SUPPLIER_CATEGORIES" :key="c" :value="c">
              {{ c }}
            </option>
          </select>
        </div>
        <div>
          <label class="field-label">简称/别名（逗号分隔）</label>
          <input v-model="aliasesText" class="field-input w-full" placeholder="如: 华东,东建">
        </div>
        <div>
          <label class="field-label">统一社会信用代码</label>
          <input v-model="draft.uniqueCode" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">税号</label>
          <input v-model="draft.taxNo" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">法定代表人</label>
          <input v-model="draft.legalRep" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">注册资金 (万元)</label>
          <input v-model.number="draft.registeredCapital" type="number" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">注册日期</label>
          <input v-model="draft.registeredDate" type="date" class="field-input w-full">
        </div>
        <div class="col-span-2">
          <label class="field-label">注册地址</label>
          <input v-model="draft.address" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">主营业务</label>
          <input v-model="draft.mainBusiness" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">业务类型</label>
          <input v-model="draft.businessType" class="field-input w-full">
        </div>
      </div>
    </section>

    <!-- 开票/银行 -->
    <section id="form-section-invoice" class="mb-6">
      <h4 class="text-13px font-800 text-brand-deep mb-3">
        开票/银行
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">开票名称</label>
          <input v-model="draft.invoiceName" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">纳税人类型</label>
          <input v-model="draft.taxpayerType" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">开户行</label>
          <input v-model="draft.bank" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">银行账号</label>
          <input v-model="draft.bankAccount" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">开票地址</label>
          <input v-model="draft.invoiceAddress" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">电话</label>
          <input v-model="draft.phone" class="field-input w-full">
        </div>
      </div>
    </section>

    <!-- 联系/其他 -->
    <section id="form-section-contact" class="mb-6">
      <h4 class="text-13px font-800 text-brand-deep mb-3">
        联系/其他
      </h4>
      <div class="grid grid-cols-2 gap-x-4 gap-y-3">
        <div>
          <label class="field-label">主要联系人 (签约代表)</label>
          <input v-model="draft.contact" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">联系方式</label>
          <input v-model="draft.contactPhone" class="field-input w-full">
        </div>
        <div>
          <label class="field-label">评价等级</label>
          <input v-model="draft.rating" class="field-input w-full">
        </div>
      </div>
    </section>

    <div>
      <label class="field-label">备注</label>
      <textarea v-model="draft.note" class="field-input w-full" rows="3" />
    </div>
  </FormDialog>
</template>
