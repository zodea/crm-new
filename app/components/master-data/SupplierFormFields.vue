<script setup lang="ts">
import type { SupplierFormDraft } from '~/lib/master-data/forms'
import { useClipboard } from '@vueuse/core'
import { computed, useId } from 'vue'
import { openExternalUrl } from '~/lib/platform/external-url'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { formatShanghaiDateTime } from '~/lib/util/datetime'
import { toErrorMessage } from '~/lib/util/error'

const props = defineProps<{
  fieldErrors: Record<string, string>
}>()

const emit = defineEmits<{
  clearError: [field: keyof SupplierFormDraft]
}>()

const draft = defineModel<SupplierFormDraft>({ required: true })
const GUANGDONG_TAX_QUERY_URL = 'https://etax.guangdong.chinatax.gov.cn:8443/xxbg/view/zhsffw/#/query/ybnsrzgcx'
const detailStore = useSupplierDetailStore()
const { copy, isSupported: clipboardSupported } = useClipboard()
const { error, formModal, success, warning } = useKitUI()
const taxNoInputId = useId()
const taxpayerTypeInputId = useId()
const invoiceAddressInputId = useId()

const aliasesText = computed({
  get: () => draft.value.aliases?.join('、') ?? '',
  set: (value: string) => {
    draft.value.aliases = value
      .split(/[，,、;；]/)
      .map(item => item.trim())
      .filter(Boolean)
  },
})
const taxpayerVerificationLabel = computed(() => ({
  not_checked: '尚未核验',
  confirmed_general: '已确认一般纳税人',
  not_found: '官网未查到，保持未核验',
  manually_confirmed: '其他官方资料人工确认',
})[draft.value.taxpayerVerificationStatus || 'not_checked'] ?? '待确认')
const taxpayerVerificationSourceLabel = computed(() => {
  const source = draft.value.taxpayerVerificationSource?.trim() ?? ''
  if (!source)
    return '未记录来源'
  return source === GUANGDONG_TAX_QUERY_URL ? '广东省电子税务局' : source
})

function formatVerificationTime(value: string | null | undefined): string {
  return formatShanghaiDateTime(value, '未记录时间')
}

function fieldClass(field: keyof SupplierFormDraft) {
  return props.fieldErrors[field]
    ? 'field-input w-full border-danger! ring-1 ring-danger/20'
    : 'field-input w-full'
}

async function copyTaxNo() {
  const taxNo = (draft.value.taxNo ?? '').trim()
  if (!taxNo) {
    warning('请先填写统一社会信用代码')
    return
  }
  if (!clipboardSupported.value) {
    warning('当前环境不支持自动复制，请手工复制税号')
    return
  }
  await copy(taxNo)
  success('税号已复制')
}

async function openTaxQuery() {
  if (!(draft.value.taxNo ?? '').trim())
    warning('尚未填写税号，仍可打开官网后手工输入')
  try {
    const opened = await openExternalUrl(GUANGDONG_TAX_QUERY_URL)
    if (!opened)
      warning('浏览器阻止了查询窗口，请允许弹出窗口后重试')
  }
  catch (cause) {
    error(`无法打开广东税务查询：${toErrorMessage(cause)}`)
  }
}

async function recordTaxpayerVerification() {
  if (!draft.value.id) {
    warning('请先保存分供方，再记录官网核验结果')
    return
  }
  const values = await formModal({
    title: '记录纳税人核验结果',
    subtitle: '验证码和查询由用户在广东省电子税务局完成；“未查到”不会自动认定为小规模纳税人。',
    saveText: '保存核验记录',
    fields: [
      {
        key: 'status',
        label: '核验结果',
        type: 'select',
        value: '已确认一般纳税人',
        options: [
          '已确认一般纳税人',
          '官网未查到，保持未核验',
          '其他官方资料人工确认',
        ],
        required: true,
      },
      {
        key: 'taxpayerType',
        label: '人工确认类型',
        type: 'select',
        value: draft.value.taxpayerType || '未核验',
        options: ['未核验', '一般纳税人', '小规模纳税人'],
      },
      {
        key: 'note',
        label: '核验备注',
        type: 'textarea',
        value: '',
        placeholder: '可记录查询范围、材料来源或未查到原因',
      },
    ],
  })
  if (!values)
    return

  const statusLabel = String(values.status)
  const status = statusLabel === '已确认一般纳税人'
    ? 'confirmed_general'
    : statusLabel === '官网未查到，保持未核验'
      ? 'not_found'
      : 'manually_confirmed'
  const selectedTaxpayerType = String(values.taxpayerType) as '未核验' | '一般纳税人' | '小规模纳税人'
  const taxpayerType = status === 'confirmed_general'
    ? '一般纳税人'
    : status === 'not_found'
      ? '未核验'
      : selectedTaxpayerType
  const verificationSource = status === 'manually_confirmed'
    ? '其他官方资料'
    : GUANGDONG_TAX_QUERY_URL
  const verificationNote = String(values.note ?? '').trim()
  try {
    const result = await detailStore.recordTaxpayerVerification({
      supplierId: draft.value.id,
      status,
      taxpayerType,
      source: verificationSource,
      note: verificationNote,
    })
    draft.value.taxpayerType = result.taxpayerType
    draft.value.taxpayerVerificationStatus = result.status
    draft.value.taxpayerVerificationSource = result.source
    draft.value.taxpayerVerifiedAt = result.verifiedAt
    draft.value.taxpayerVerificationNote = result.note
    success('纳税人核验记录已保存')
  }
  catch (cause) {
    error(`核验记录保存失败：${toErrorMessage(cause)}`)
  }
}

function copyRegisteredAddress() {
  if (!(draft.value.address ?? '').trim()) {
    warning('请先填写注册地址')
    return
  }
  draft.value.invoiceAddress = draft.value.address ?? ''
  success('已复制注册地址；后续可独立修改开票资料地址')
}
</script>

<template>
  <section id="section-basic" class="panel scroll-mt-4 p-4">
    <SectionHeader title="基础信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">公司全称 *</span>
        <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="emit('clearError', 'name')">
        <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">简称/别名</span>
        <input v-model="aliasesText" class="field-input w-full" placeholder="多个别名用逗号或顿号分隔">
      </label>
      <label class="field-block">
        <span class="field-label">分供方类别 *</span>
        <select v-model="draft.supplierCategory" :class="fieldClass('supplierCategory')" data-field="supplierCategory" @change="emit('clearError', 'supplierCategory')">
          <option value="">
            请选择
          </option>
          <option v-for="category in SUPPLIER_CATEGORIES" :key="category" :value="category">
            {{ category }}
          </option>
        </select>
        <span v-if="fieldErrors.supplierCategory" class="field-error">{{ fieldErrors.supplierCategory }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">经营类型</span>
        <input v-model="draft.businessType" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">唯一识别码</span>
        <input v-model="draft.uniqueCode" class="field-input w-full font-mono">
      </label>
      <div class="field-block">
        <label :for="taxNoInputId" class="field-label">统一社会信用代码</label>
        <div class="flex min-w-0 gap-2">
          <input :id="taxNoInputId" v-model="draft.taxNo" class="field-input min-w-0 flex-1 font-mono">
          <button type="button" class="btn-secondary shrink-0 px-2" @click="copyTaxNo">
            复制税号
          </button>
        </div>
      </div>
      <label class="field-block">
        <span class="field-label">法定代表人</span>
        <input v-model="draft.legalRep" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">注册资金（万元）</span>
        <input v-model.number="draft.registeredCapital" type="number" min="0" step="0.01" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">注册日期</span>
        <input v-model="draft.registeredDate" type="date" class="field-input w-full">
      </label>
      <div class="field-block">
        <label :for="taxpayerTypeInputId" class="field-label">纳税人类型</label>
        <select :id="taxpayerTypeInputId" v-model="draft.taxpayerType" class="field-input w-full">
          <option value="未核验">
            未核验
          </option>
          <option value="一般纳税人">
            一般纳税人
          </option>
          <option value="小规模纳税人">
            小规模纳税人
          </option>
        </select>
        <span class="field-hint">默认未核验；官网未查到不等于小规模纳税人。</span>
        <div
          class="mt-2 grid gap-1 border border-line bg-surface-2 p-2 text-11px text-ink-soft"
          role="status"
          aria-label="纳税人核验留痕"
        >
          <strong class="text-ink">{{ taxpayerVerificationLabel }}</strong>
          <span>来源：{{ taxpayerVerificationSourceLabel }}</span>
          <span>核验时间：{{ formatVerificationTime(draft.taxpayerVerifiedAt) }}</span>
          <span v-if="draft.taxpayerVerificationNote">
            备注：{{ draft.taxpayerVerificationNote }}
          </span>
        </div>
        <span class="mt-1 flex flex-wrap gap-2">
          <button type="button" class="cell--link text-11px" @click="openTaxQuery">
            打开广东税务查询
          </button>
          <button type="button" class="cell--link text-11px" @click="recordTaxpayerVerification">
            记录人工核验
          </button>
        </span>
      </div>
      <label class="field-block">
        <span class="field-label">评价等级</span>
        <input v-model="draft.rating" class="field-input w-full">
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">注册地址</span>
        <input v-model="draft.address" class="field-input w-full">
      </label>
      <label class="field-block form-span-full">
        <span class="field-label">主营业务</span>
        <textarea v-model="draft.mainBusiness" rows="3" class="field-input w-full" />
      </label>
    </div>
  </section>

  <section id="section-contact" class="panel scroll-mt-4 p-4">
    <SectionHeader title="联系人信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">主要联系人 *</span>
        <input v-model="draft.contact" :class="fieldClass('contact')" data-field="contact" @input="emit('clearError', 'contact')">
        <span v-if="fieldErrors.contact" class="field-error">{{ fieldErrors.contact }}</span>
      </label>
      <label class="field-block">
        <span class="field-label">联系人电话</span>
        <input v-model="draft.contactPhone" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">职务</span>
        <input v-model="draft.contactTitle" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">公司电话（选填）</span>
        <input v-model="draft.phone" class="field-input w-full">
      </label>
    </div>
  </section>

  <section id="section-invoice" class="panel scroll-mt-4 p-4">
    <SectionHeader title="开票与银行信息" />
    <div class="form-fields-grid mt-3">
      <label class="field-block">
        <span class="field-label">开票名称</span>
        <input v-model="draft.invoiceName" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">开户行</span>
        <input v-model="draft.bank" class="field-input w-full">
      </label>
      <label class="field-block">
        <span class="field-label">银行账号</span>
        <input v-model="draft.bankAccount" class="field-input w-full font-mono">
      </label>
      <div class="field-block">
        <span class="flex items-center justify-between gap-2">
          <label :for="invoiceAddressInputId" class="field-label">开票资料地址（选填）</label>
          <button type="button" class="cell--link text-10px" @click="copyRegisteredAddress">
            同注册地址
          </button>
        </span>
        <input :id="invoiceAddressInputId" v-model="draft.invoiceAddress" class="field-input w-full">
      </div>
    </div>
  </section>
</template>
