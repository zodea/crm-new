<script setup lang="ts">
const open = defineModel<boolean>('open', { required: true })

const store = useInvoiceStore()
const projectStore = useProjectStore()
const { success, warning } = useKitUI()

const OWNER_KIND_LABEL = { project: '归属项目', personal: '个人开支' } as const
const NO_ATTRIBUTION_LABEL = '暂不归属'

const form = reactive({
  invoiceType: '增值税专用发票',
  invoiceNumber: '',
  invoiceDate: '',
  buyer: '广州市瑞航建筑工程有限公司',
  seller: '',
  amount: 0,
  taxAmount: 0,
  totalAmount: 0,
  taxRate: '13%',
  remark: '',
  projectName: '',
  source: 'excel' as const,
  ownerKindLabel: NO_ATTRIBUTION_LABEL,
})

function reset() {
  Object.assign(form, {
    invoiceType: '增值税专用发票',
    invoiceNumber: '',
    invoiceDate: '',
    buyer: '广州市瑞航建筑工程有限公司',
    seller: '',
    amount: 0,
    taxAmount: 0,
    totalAmount: 0,
    taxRate: '13%',
    remark: '',
    projectName: '',
    ownerKindLabel: NO_ATTRIBUTION_LABEL,
  })
}

async function save() {
  if (!form.invoiceNumber && !form.seller) {
    warning('请至少填写发票号码或供应商')
    return
  }
  const { ownerKindLabel, ...invoiceData } = form
  const id = await store.add({
    ...invoiceData,
    ocrStatus: 'done',
    reviewStatus: 'reviewed',
    confirmedAt: new Date().toISOString(),
  })
  if (ownerKindLabel === NO_ATTRIBUTION_LABEL) {
    success('发票已添加，待归档后计入台账')
  }
  else {
    const ownerKind = ownerKindLabel === OWNER_KIND_LABEL.personal ? 'personal' : 'project'
    const project = ownerKind === 'project' ? projectStore.list.find(item => item.name === form.projectName) : undefined
    const result = await store.archiveInvoice(id, ownerKind, project?.id ?? null, project?.name)
    if (result.ok)
      success('发票已添加并归档，计入台账')
    else
      warning(`发票已添加，但归档失败：${result.reason}`)
  }
  open.value = false
  reset()
}
</script>

<template>
  <FormDialog
    :open="open"
    title="手动录入发票"
    save-label="添加"
    width="min(640px, 95vw)"
    @save="save"
    @cancel="open = false"
  >
    <div class="grid grid-cols-2 gap-x-4 gap-y-3">
      <div>
        <label class="field-label">票据类型</label>
        <select v-model="form.invoiceType" class="field-input w-full">
          <option value="增值税专用发票">
            增值税专用发票
          </option>
          <option value="增值税普通发票">
            增值税普通发票
          </option>
        </select>
      </div>
      <div>
        <label class="field-label">发票号码</label>
        <input v-model="form.invoiceNumber" class="field-input w-full font-mono" placeholder="发票号码">
      </div>
      <div>
        <label class="field-label">开票日期</label>
        <input v-model="form.invoiceDate" type="date" class="field-input w-full font-mono">
      </div>
      <div>
        <label class="field-label">税率</label>
        <select v-model="form.taxRate" class="field-input w-full">
          <option v-for="rate in ['13%', '9%', '6%', '3%', '1%', '0%']" :key="rate" :value="rate">
            {{ rate }}
          </option>
        </select>
      </div>
      <div>
        <label class="field-label">购买方</label>
        <input v-model="form.buyer" class="field-input w-full">
      </div>
      <div>
        <label class="field-label">供应商（销方）</label>
        <input v-model="form.seller" class="field-input w-full" placeholder="供应商名称">
      </div>
      <div>
        <label class="field-label">不含税金额</label>
        <input v-model.number="form.amount" type="number" class="field-input w-full font-mono" step="0.01">
      </div>
      <div>
        <label class="field-label">税额</label>
        <input v-model.number="form.taxAmount" type="number" class="field-input w-full font-mono" step="0.01">
      </div>
      <div>
        <label class="field-label">价税合计</label>
        <input v-model.number="form.totalAmount" type="number" class="field-input w-full font-mono" step="0.01">
      </div>
      <div>
        <label class="field-label">对应项目</label>
        <input v-model="form.projectName" class="field-input w-full" placeholder="项目名称" list="invoice-project-names">
        <datalist id="invoice-project-names">
          <option v-for="project in projectStore.list" :key="project.id" :value="project.name" />
        </datalist>
      </div>
      <div>
        <label class="field-label">发票归属</label>
        <select v-model="form.ownerKindLabel" class="field-input w-full">
          <option :value="NO_ATTRIBUTION_LABEL">
            暂不归属（先录入，台账页再归档）
          </option>
          <option :value="OWNER_KIND_LABEL.project">
            {{ OWNER_KIND_LABEL.project }}
          </option>
          <option :value="OWNER_KIND_LABEL.personal">
            {{ OWNER_KIND_LABEL.personal }}
          </option>
        </select>
      </div>
      <div class="col-span-2">
        <label class="field-label">票面备注</label>
        <input v-model="form.remark" class="field-input w-full" placeholder="备注信息">
      </div>
    </div>
  </FormDialog>
</template>
