<script setup lang="ts">
import type { LookupOption } from '~/lib/kit/lookup'
import type {
  CrewFormDraft,
  CustomerFormDraft,
  FormAttachment,
  FormAttachmentChanges,
  FormAttachmentDraft,
  MasterDataOwnerType,
  MasterDataSaveAction,
  ProjectFormDraft,
  SupplierFormDraft,
  TargetCostFormDraft,
  WorkerFormDraft,
} from '~/lib/master-data/forms'
import type { FormFooterAction } from '~/lib/master-data/page'
import { onBeforeRouteLeave } from 'vue-router'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import {
  listFormAttachments,
  loadCrewForm,
  loadCustomerForm,
  loadProjectForm,
  loadSupplierForm,
  loadTargetCostForm,
  loadWorkerForm,
} from '~/lib/master-data/forms'
import {
  FORM_META,
  formDefaults,
  formRequiredFields,
} from '~/lib/master-data/page'
import { PROJECT_STATUSES } from '~/lib/project/status'
import { SUPPLIER_CATEGORIES } from '~/lib/supplier/status'
import { toErrorMessage } from '~/lib/util/error'

type PageDraft
  = SupplierFormDraft
    & CustomerFormDraft
    & CrewFormDraft
    & WorkerFormDraft
    & ProjectFormDraft
    & TargetCostFormDraft

interface PendingAttachment extends FormAttachmentDraft {
  localId: string
}

const props = defineProps<{
  kind: MasterDataOwnerType
}>()

const route = useRoute()
const supplierStore = useSupplierStore()
const customerStore = useCustomerStore()
const crewStore = useCrewStore()
const workerStore = useWorkerStore()
const projectStore = useProjectStore()
const targetCostStore = useTargetCostStore()
const { confirm, success, warning, error } = useKitUI()

const meta = computed(() => FORM_META[props.kind])
const routeId = computed(() => {
  const value = route.params.id
  return Array.isArray(value) ? value[0] : value
})
const isEditing = computed(() => Boolean(routeId.value))
const title = computed(() => `${isEditing.value ? '编辑' : '新建'} · ${meta.value.label}`)
useTabTitle(title)

const draft = ref<PageDraft>(formDefaults(props.kind) as PageDraft)
const attachments = shallowRef<FormAttachment[]>([])
const pendingAttachments = shallowRef<PendingAttachment[]>([])
const pendingRemoveIds = shallowRef<string[]>([])
const fieldErrors = shallowRef<Record<string, string>>({})
const loading = shallowRef(false)
const loadingAction = shallowRef<FormFooterAction | null>(null)
const closeAfterSave = shallowRef(true)
const savedSnapshot = shallowRef('')
let allowLeave = false

const aliasesText = computed({
  get: () => draft.value.aliases?.join('、') ?? '',
  set: (value: string) => {
    draft.value.aliases = value
      .split(/[，,、;；]/)
      .map(item => item.trim())
      .filter(Boolean)
  },
})

const dirty = computed(() => JSON.stringify(draft.value) !== savedSnapshot.value
  || pendingAttachments.value.length > 0
  || pendingRemoveIds.value.length > 0)

const sections = computed(() => meta.value.sections)

async function queryLookup(
  table: 'customers' | 'projects' | 'crews',
  keyword: string,
  includeAliases = false,
): Promise<LookupOption[]> {
  const pattern = `%${keyword.trim()}%`
  const aliasClause = includeAliases ? 'OR aliases LIKE ?' : ''
  const params = includeAliases ? [pattern, pattern] : [pattern]
  const rows = await select<{ id: string, name: string }>(
    selectVisibleSql(
      table,
      `AND (name LIKE ? ${aliasClause}) ORDER BY name LIMIT 50`,
    ),
    params,
  )
  return rows.map(row => ({ id: row.id, label: row.name }))
}

const fetchCustomers = (keyword: string) => queryLookup('customers', keyword, true)
const fetchProjects = (keyword: string) => queryLookup('projects', keyword)
const fetchCrews = (keyword: string) => queryLookup('crews', keyword)

async function loadRecord(id: string): Promise<PageDraft | null> {
  switch (props.kind) {
    case 'supplier': return await loadSupplierForm(id) as PageDraft | null
    case 'customer': return await loadCustomerForm(id) as PageDraft | null
    case 'crew': return await loadCrewForm(id) as PageDraft | null
    case 'worker': return await loadWorkerForm(id) as PageDraft | null
    case 'project': return await loadProjectForm(id) as PageDraft | null
    case 'target_cost': return await loadTargetCostForm(id) as PageDraft | null
  }
}

async function initialize() {
  loading.value = true
  fieldErrors.value = {}
  pendingAttachments.value = []
  pendingRemoveIds.value = []
  try {
    const id = routeId.value
    if (!id) {
      draft.value = formDefaults(props.kind) as PageDraft
      attachments.value = []
    }
    else {
      const [record, files] = await Promise.all([
        loadRecord(id),
        listFormAttachments(props.kind, id),
      ])
      if (!record) {
        error(`${meta.value.label}不存在或已删除`)
        allowLeave = true
        await navigateTo(meta.value.listPath)
        return
      }
      draft.value = {
        ...formDefaults(props.kind),
        ...record,
      } as PageDraft
      attachments.value = files
    }
    await nextTick()
    savedSnapshot.value = JSON.stringify(draft.value)
  }
  finally {
    loading.value = false
  }
}

function validateRequired(): boolean {
  const errors: Record<string, string> = {}
  for (const [field, label] of formRequiredFields(props.kind)) {
    const value = draft.value[field as keyof PageDraft]
    if (typeof value === 'string' ? !value.trim() : value == null)
      errors[field] = `${label}为必填项`
  }
  fieldErrors.value = errors
  const labels = Object.values(errors)
  if (labels.length)
    warning(`${labels[0]}（共 ${labels.length} 处）`)
  return labels.length === 0
}

function fieldClass(field: keyof PageDraft) {
  return fieldErrors.value[field]
    ? 'field-input w-full border-danger! ring-1 ring-danger/20'
    : 'field-input w-full'
}

function clearFieldError(field: keyof PageDraft) {
  if (!fieldErrors.value[field])
    return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function attachmentChanges(): FormAttachmentChanges {
  return {
    add: pendingAttachments.value.map(({ localId: _localId, ...file }) => file),
    removeIds: pendingRemoveIds.value,
  }
}

async function saveThroughStore(action: MasterDataSaveAction) {
  switch (props.kind) {
    case 'supplier':
      return supplierStore.saveForm(draft.value, action, attachmentChanges())
    case 'customer':
      return customerStore.save(draft.value, action, attachmentChanges())
    case 'crew':
      return crewStore.save(draft.value, action, attachmentChanges())
    case 'worker':
      return workerStore.save(draft.value, action, attachmentChanges())
    case 'project':
      return projectStore.saveForm(draft.value, action, attachmentChanges())
    case 'target_cost':
      return targetCostStore.save(draft.value, action, attachmentChanges())
  }
}

async function handleFooterAction(action: FormFooterAction) {
  if (action === 'cancel') {
    if (dirty.value) {
      const leave = await confirm({
        variant: 'simple',
        title: '放弃修改',
        message: '当前表单还有未保存内容，确认放弃并返回列表？',
        confirmLabel: '放弃修改',
      })
      if (!leave)
        return
    }
    allowLeave = true
    await navigateTo(meta.value.listPath)
    return
  }

  const saveAction: MasterDataSaveAction
    = action === 'draft'
      ? 'draft'
      : action === 'saveSubmit'
        ? 'submit'
        : 'save'
  if (saveAction !== 'draft' && !validateRequired())
    return

  loadingAction.value = action
  try {
    const result = await saveThroughStore(saveAction)
    success(saveAction === 'draft' ? '草稿已保存' : '保存成功')
    pendingAttachments.value = []
    pendingRemoveIds.value = []
    fieldErrors.value = {}

    if (action === 'saveNew') {
      allowLeave = true
      if (route.path === meta.value.newPath) {
        draft.value = formDefaults(props.kind) as PageDraft
        attachments.value = []
        savedSnapshot.value = JSON.stringify(draft.value)
      }
      else {
        await navigateTo(meta.value.newPath)
      }
      return
    }

    if (closeAfterSave.value) {
      allowLeave = true
      await navigateTo(meta.value.listPath)
      return
    }

    if (!isEditing.value) {
      allowLeave = true
      await navigateTo(`${meta.value.newPath}/${result.id}`)
      return
    }
    await initialize()
  }
  catch (cause) {
    error(`保存失败：${toErrorMessage(cause)}`)
  }
  finally {
    loadingAction.value = null
  }
}

function handleFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  pendingAttachments.value = [
    ...pendingAttachments.value,
    ...files.map(file => ({
      localId: `${file.name}-${file.size}-${file.lastModified}`,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      category: meta.value.defaultAttachmentCategory,
    })),
  ]
  input.value = ''
}

function removePending(localId: string) {
  pendingAttachments.value = pendingAttachments.value.filter(file => file.localId !== localId)
}

function toggleExistingAttachment(id: string) {
  pendingRemoveIds.value = pendingRemoveIds.value.includes(id)
    ? pendingRemoveIds.value.filter(item => item !== id)
    : [...pendingRemoveIds.value, id]
}

onBeforeRouteLeave(async () => {
  if (allowLeave || !dirty.value)
    return true
  return confirm({
    variant: 'simple',
    title: '放弃修改',
    message: '当前表单还有未保存内容，确认离开？',
    confirmLabel: '放弃修改',
  })
})

watch(() => routeId.value, () => {
  allowLeave = false
  void initialize()
}, { immediate: true })
</script>

<template>
  <div class="mx-auto flex w-full max-w-1340px items-start gap-4 pb-6">
    <aside
      v-if="sections.length >= 3"
      class="sticky top-4 hidden w-44 shrink-0 rounded-[var(--radius-card)] border border-line bg-panel p-2 xl:block"
      aria-label="表单分区"
    >
      <a
        v-for="section in sections"
        :key="section.key"
        :href="`#section-${section.key}`"
        class="block rounded-[var(--radius-control)] px-3 py-2 text-12px text-ink-soft transition-colors hover:bg-brand-soft hover:text-brand-deep"
      >
        {{ section.label }}
      </a>
    </aside>

    <main class="min-w-0 flex-1">
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <NuxtLink :to="meta.listPath" class="mb-1 inline-flex items-center gap-1 text-12px text-brand-deep">
            <span class="i-lucide-arrow-left" aria-hidden="true" />
            返回{{ meta.listLabel }}
          </NuxtLink>
          <h1 class="text-20px font-800 text-ink">
            {{ title }}
          </h1>
          <p class="mt-1 text-12px text-ink-faint">
            草稿可暂存不完整内容；提交时校验必填、关联和金额规则。
          </p>
        </div>
        <span v-if="draft.status || draft.approvalStatus" class="chip bg-surface-3 text-ink-soft">
          {{ draft.approvalStatus || draft.status }}
        </span>
      </header>

      <div v-if="loading" class="panel grid min-h-56 place-items-center text-13px text-ink-faint">
        正在载入表单…
      </div>

      <form v-else class="flex flex-col gap-4" @submit.prevent>
        <!-- 分供方 -->
        <template v-if="kind === 'supplier'">
          <section id="section-basic" class="panel scroll-mt-4 p-4">
            <SectionHeader title="基础信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">公司全称 *</span>
                <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="clearFieldError('name')">
                <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">简称/别名</span>
                <input v-model="aliasesText" class="field-input w-full" placeholder="多个别名用逗号或顿号分隔">
              </label>
              <label class="field-block">
                <span class="field-label">分供方类别 *</span>
                <select v-model="draft.supplierCategory" :class="fieldClass('supplierCategory')" data-field="supplierCategory" @change="clearFieldError('supplierCategory')">
                  <option value="">请选择</option>
                  <option v-for="category in SUPPLIER_CATEGORIES" :key="category" :value="category">{{ category }}</option>
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
              <label class="field-block">
                <span class="field-label">统一社会信用代码</span>
                <input v-model="draft.taxNo" class="field-input w-full font-mono">
              </label>
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
              <label class="field-block">
                <span class="field-label">纳税人类型</span>
                <select v-model="draft.taxpayerType" class="field-input w-full">
                  <option value="未核验">未核验</option>
                  <option value="一般纳税人">一般纳税人</option>
                  <option value="小规模纳税人">小规模纳税人</option>
                </select>
              </label>
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
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">主要联系人 *</span>
                <input v-model="draft.contact" :class="fieldClass('contact')" data-field="contact" @input="clearFieldError('contact')">
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
                <span class="field-label">公司电话</span>
                <input v-model="draft.phone" class="field-input w-full">
              </label>
            </div>
          </section>

          <section id="section-invoice" class="panel scroll-mt-4 p-4">
            <SectionHeader title="开票与银行信息" />
            <div class="form-grid">
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
              <label class="field-block">
                <span class="field-label">开票地址</span>
                <input v-model="draft.invoiceAddress" class="field-input w-full">
              </label>
            </div>
          </section>
        </template>

        <!-- 客户 -->
        <template v-else-if="kind === 'customer'">
          <section id="section-basic" class="panel scroll-mt-4 p-4">
            <SectionHeader title="基础信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">客户名称 *</span>
                <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="clearFieldError('name')">
                <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">简称/别名</span>
                <input v-model="aliasesText" class="field-input w-full" placeholder="多个别名用逗号或顿号分隔">
              </label>
              <label class="field-block">
                <span class="field-label">统一社会信用代码</span>
                <input v-model="draft.taxNo" class="field-input w-full font-mono">
              </label>
              <label class="field-block">
                <span class="field-label">法定代表人</span>
                <input v-model="draft.legalRep" class="field-input w-full">
              </label>
              <label class="field-block form-span-full">
                <span class="field-label">注册地址</span>
                <input v-model="draft.registeredAddress" class="field-input w-full">
              </label>
            </div>
          </section>
          <section id="section-invoice" class="panel scroll-mt-4 p-4">
            <SectionHeader title="开票与银行" />
            <div class="form-grid">
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
            </div>
          </section>
          <section id="section-contact" class="panel scroll-mt-4 p-4">
            <SectionHeader title="联系与备注" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">联系人 *</span>
                <input v-model="draft.contact" :class="fieldClass('contact')" data-field="contact" @input="clearFieldError('contact')">
                <span v-if="fieldErrors.contact" class="field-error">{{ fieldErrors.contact }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">联系电话</span>
                <input v-model="draft.contactPhone" class="field-input w-full">
              </label>
            </div>
          </section>
        </template>

        <!-- 班组 -->
        <template v-else-if="kind === 'crew'">
          <section id="section-basic" class="panel scroll-mt-4 p-4">
            <SectionHeader title="基本信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">班组名称 *</span>
                <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="clearFieldError('name')">
                <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">工种 *</span>
                <input v-model="draft.trade" :class="fieldClass('trade')" data-field="trade" @input="clearFieldError('trade')">
                <span v-if="fieldErrors.trade" class="field-error">{{ fieldErrors.trade }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">负责人 *</span>
                <input v-model="draft.contactName" :class="fieldClass('contactName')" data-field="contactName" @input="clearFieldError('contactName')">
                <span v-if="fieldErrors.contactName" class="field-error">{{ fieldErrors.contactName }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">联系电话 *</span>
                <input v-model="draft.contactPhone" :class="fieldClass('contactPhone')" data-field="contactPhone" @input="clearFieldError('contactPhone')">
                <span v-if="fieldErrors.contactPhone" class="field-error">{{ fieldErrors.contactPhone }}</span>
              </label>
            </div>
          </section>
          <section id="section-pay" class="panel scroll-mt-4 p-4">
            <SectionHeader title="计薪与提成" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">默认发放比例</span>
                <input v-model.number="draft.defaultPayRatio" type="number" min="0" max="1" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">指派粒度</span>
                <select v-model="draft.assignmentLevel" class="field-input w-full">
                  <option value="crew">班组</option>
                  <option value="worker">个人</option>
                </select>
              </label>
              <label class="field-block">
                <span class="field-label">房租补贴</span>
                <span class="flex items-center gap-2">
                  <input v-model="draft.rentSubsidyEnabled" type="checkbox" class="accent-brand">
                  <span class="text-12px text-ink-soft">启用</span>
                </span>
              </label>
              <label class="field-block">
                <span class="field-label">房租补贴单价</span>
                <input v-model.number="draft.rentSubsidyPrice" type="number" min="0" step="0.01" :disabled="!draft.rentSubsidyEnabled" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">管理提成</span>
                <span class="flex items-center gap-2">
                  <input v-model="draft.mgmtFeeEnabled" type="checkbox" class="accent-brand">
                  <span class="text-12px text-ink-soft">启用</span>
                </span>
              </label>
              <label class="field-block">
                <span class="field-label">管理提成单价</span>
                <input v-model.number="draft.mgmtFeePrice" type="number" min="0" step="0.01" :disabled="!draft.mgmtFeeEnabled" class="field-input w-full">
              </label>
            </div>
          </section>
        </template>

        <!-- 工人 -->
        <template v-else-if="kind === 'worker'">
          <section id="section-personal" class="panel scroll-mt-4 p-4">
            <SectionHeader title="个人信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">姓名 *</span>
                <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="clearFieldError('name')">
                <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">性别</span>
                <select v-model="draft.gender" class="field-input w-full">
                  <option value="">未填写</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                </select>
              </label>
              <label class="field-block form-span-full">
                <span class="field-label">身份证号</span>
                <input v-model="draft.idCard" class="field-input w-full font-mono">
              </label>
              <label class="field-block">
                <span class="field-label">联系电话 *</span>
                <input v-model="draft.phone" :class="fieldClass('phone')" data-field="phone" @input="clearFieldError('phone')">
                <span v-if="fieldErrors.phone" class="field-error">{{ fieldErrors.phone }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">籍贯</span>
                <input v-model="draft.hometown" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">紧急联系人</span>
                <input v-model="draft.emergencyContact" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">紧急联系电话</span>
                <input v-model="draft.emergencyPhone" class="field-input w-full">
              </label>
            </div>
          </section>
          <section id="section-bank" class="panel scroll-mt-4 p-4">
            <SectionHeader title="银行信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">开户银行 *</span>
                <input v-model="draft.bankName" :class="fieldClass('bankName')" data-field="bankName" @input="clearFieldError('bankName')">
                <span v-if="fieldErrors.bankName" class="field-error">{{ fieldErrors.bankName }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">银行卡号 *</span>
                <input v-model="draft.bankAccount" :class="fieldClass('bankAccount')" data-field="bankAccount" @input="clearFieldError('bankAccount')">
                <span v-if="fieldErrors.bankAccount" class="field-error">{{ fieldErrors.bankAccount }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">银行行号</span>
                <input v-model="draft.bankCode" class="field-input w-full font-mono">
              </label>
            </div>
          </section>
          <section id="section-work" class="panel scroll-mt-4 p-4">
            <SectionHeader title="工作信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">工种 *</span>
                <input v-model="draft.trade" :class="fieldClass('trade')" data-field="trade" @input="clearFieldError('trade')">
                <span v-if="fieldErrors.trade" class="field-error">{{ fieldErrors.trade }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">技能等级</span>
                <input v-model="draft.skillLevel" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">参考日工资</span>
                <input v-model.number="draft.dailyWage" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">所属班组</span>
                <LookupSelect v-model="draft.crewId" :fetch="fetchCrews" recent-key="worker-crews" placeholder="检索班组" />
              </label>
              <label class="field-block">
                <span class="field-label">亲属组 ID</span>
                <input v-model="draft.familyGroupId" class="field-input w-full">
              </label>
            </div>
          </section>
          <section id="section-project" class="panel scroll-mt-4 p-4">
            <SectionHeader title="项目分配" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">当前项目</span>
                <LookupSelect v-model="draft.currentProjectId" :fetch="fetchProjects" recent-key="worker-projects" placeholder="检索项目" />
              </label>
              <label class="field-block">
                <span class="field-label">在场状态</span>
                <select v-model="draft.projectStatus" class="field-input w-full">
                  <option value="在场">在场</option>
                  <option value="已退场">已退场</option>
                </select>
              </label>
              <label class="field-block">
                <span class="field-label">进场日期</span>
                <input v-model="draft.entryDate" type="date" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">退场日期</span>
                <input v-model="draft.exitDate" type="date" class="field-input w-full">
              </label>
              <label class="field-block form-span-full">
                <span class="flex items-center gap-2">
                  <input v-model="draft.safetyEducation" type="checkbox" class="accent-brand">
                  <span class="field-label mb-0">已完成三级安全教育</span>
                </span>
              </label>
            </div>
          </section>
        </template>

        <!-- 项目 -->
        <template v-else-if="kind === 'project'">
          <section id="section-basic" class="panel scroll-mt-4 p-4">
            <SectionHeader title="基本信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">项目名称 *</span>
                <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="clearFieldError('name')">
                <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">项目合同名称</span>
                <input v-model="draft.contractName" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">项目编号</span>
                <input v-model="draft.code" class="field-input w-full font-mono">
              </label>
              <label class="field-block">
                <span class="field-label">客户（甲方） *</span>
                <LookupSelect v-model="draft.customerId" :fetch="fetchCustomers" recent-key="project-customers" placeholder="检索客户" @update:model-value="clearFieldError('customerId')" />
                <span v-if="fieldErrors.customerId" class="field-error">{{ fieldErrors.customerId }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">客户2</span>
                <LookupSelect v-model="draft.secondaryCustomerId" :fetch="fetchCustomers" recent-key="project-secondary-customers" placeholder="检索次客户" />
              </label>
              <label class="field-block">
                <span class="field-label">工程地域</span>
                <input v-model="draft.region" class="field-input w-full">
              </label>
              <label class="field-block form-span-full">
                <span class="field-label">详细地址</span>
                <input v-model="draft.address" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">经营类型</span>
                <select v-model="draft.operationType" class="field-input w-full">
                  <option value="自营">自营</option>
                  <option value="联营">联营</option>
                  <option value="挂靠">挂靠</option>
                </select>
              </label>
              <label class="field-block">
                <span class="field-label">工程类型</span>
                <input v-model="draft.type" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">建筑面积</span>
                <input v-model.number="draft.area" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">合同金额</span>
                <input v-model.number="draft.contractAmount" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block form-span-full">
                <span class="field-label">工程概况</span>
                <textarea v-model="draft.overview" rows="3" class="field-input w-full" />
              </label>
            </div>
          </section>
          <section id="section-schedule" class="panel scroll-mt-4 p-4">
            <SectionHeader title="工期与阶段" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">业务流程阶段</span>
                <select v-model="draft.status" class="field-input w-full">
                  <option v-for="status in PROJECT_STATUSES" :key="status" :value="status">{{ status }}</option>
                </select>
              </label>
              <label class="field-block">
                <span class="field-label">计划开工</span>
                <input v-model="draft.startDate" type="date" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">计划竣工</span>
                <input v-model="draft.plannedEnd" type="date" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">计划工期（天）</span>
                <input v-model.number="draft.plannedDuration" type="number" min="0" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">实际竣工</span>
                <input v-model="draft.actualEnd" type="date" class="field-input w-full">
              </label>
            </div>
          </section>
          <section id="section-team" class="panel scroll-mt-4 p-4">
            <SectionHeader title="参建单位" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">项目经理 *</span>
                <input v-model="draft.manager" :class="fieldClass('manager')" data-field="manager" @input="clearFieldError('manager')">
                <span v-if="fieldErrors.manager" class="field-error">{{ fieldErrors.manager }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">项目经理电话</span>
                <input v-model="draft.managerPhone" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">执行经理</span>
                <input v-model="draft.execManager" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">施工员</span>
                <input v-model="draft.builder" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">承包单位</span>
                <input v-model="draft.contractor" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">监理单位</span>
                <input v-model="draft.supervisor" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">设计单位</span>
                <input v-model="draft.designer" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">甲方代表</span>
                <input v-model="draft.developerSupervisor" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">现场负责人</span>
                <input v-model="draft.siteLeader" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">现场负责人电话</span>
                <input v-model="draft.siteLeaderPhone" class="field-input w-full">
              </label>
            </div>
          </section>
          <section id="section-risk" class="panel scroll-mt-4 p-4">
            <SectionHeader title="风控与立项" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">项目风险级别</span>
                <select v-model="draft.riskLevel" class="field-input w-full">
                  <option value="低">低</option>
                  <option value="中">中</option>
                  <option value="高">高</option>
                </select>
              </label>
              <label class="field-block">
                <span class="field-label">立项文件时间</span>
                <input v-model="draft.filingDate" type="date" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">验收日期</span>
                <input v-model="draft.acceptanceDate" type="date" class="field-input w-full">
              </label>
            </div>
          </section>
        </template>

        <!-- 目标成本 -->
        <template v-else-if="kind === 'target_cost'">
          <section id="section-basic" class="panel scroll-mt-4 p-4">
            <SectionHeader title="基本信息" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">版本名 *</span>
                <input v-model="draft.name" :class="fieldClass('name')" data-field="name" @input="clearFieldError('name')">
                <span v-if="fieldErrors.name" class="field-error">{{ fieldErrors.name }}</span>
              </label>
              <label class="field-block">
                <span class="field-label">项目 *</span>
                <LookupSelect v-model="draft.projectId" :fetch="fetchProjects" recent-key="target-cost-projects" placeholder="检索项目" @update:model-value="clearFieldError('projectId')" />
                <span v-if="fieldErrors.projectId" class="field-error">{{ fieldErrors.projectId }}</span>
              </label>
              <label class="field-block form-span-full">
                <span class="flex items-center gap-2">
                  <input v-model="draft.isBaseline" type="checkbox" class="accent-brand">
                  <span class="field-label mb-0">设为当前对比基线</span>
                </span>
              </label>
            </div>
          </section>
          <section id="section-amount" class="panel scroll-mt-4 p-4">
            <SectionHeader title="金额基准" />
            <div class="form-grid">
              <label class="field-block">
                <span class="field-label">合同收入</span>
                <input v-model.number="draft.contractRevenue" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">计划利润</span>
                <input v-model.number="draft.plannedProfit" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">已签合同额</span>
                <input v-model.number="draft.signedContractSum" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">含税合价</span>
                <input v-model.number="draft.taxInclusiveTotal" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">无税合价</span>
                <input v-model.number="draft.taxExclusiveTotal" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
              <label class="field-block">
                <span class="field-label">税额</span>
                <input v-model.number="draft.taxAmount" type="number" min="0" step="0.01" class="field-input w-full">
              </label>
            </div>
            <p class="mt-3 text-11px text-ink-faint">
              含税、无税和税额只作勾稽提示，不自动覆盖人工确认值。
            </p>
          </section>
        </template>

        <section id="section-attachments" class="panel scroll-mt-4 p-4">
          <SectionHeader :title="kind === 'worker' ? '证书档案' : '附件'" />
          <label class="flex min-h-24 cursor-pointer flex-col items-center justify-center rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface-2 px-4 text-center transition-colors hover:border-brand hover:bg-brand-soft">
            <span class="i-lucide-upload-cloud mb-1 text-22px text-brand" aria-hidden="true" />
            <span class="text-12px font-600 text-ink">点击选择附件</span>
            <span class="mt-0.5 text-11px text-ink-faint">仅保存文件引用元数据，不把文件数组写进业务头表</span>
            <input type="file" multiple class="sr-only" @change="handleFiles">
          </label>

          <div v-if="attachments.length || pendingAttachments.length" class="mt-3 grid gap-2">
            <div
              v-for="file in attachments"
              :key="file.id"
              class="flex items-center gap-2 rounded-[var(--radius-control)] border border-line px-3 py-2"
              :class="pendingRemoveIds.includes(file.id) ? 'bg-danger-soft opacity-65' : 'bg-panel'"
            >
              <span class="i-lucide-paperclip text-ink-faint" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-12px text-ink">{{ file.fileName }}</span>
              <span class="text-10px text-ink-faint">{{ file.category || '未分类' }}</span>
              <button type="button" class="text-11px text-danger" @click="toggleExistingAttachment(file.id)">
                {{ pendingRemoveIds.includes(file.id) ? '撤销删除' : '删除' }}
              </button>
            </div>
            <div
              v-for="file in pendingAttachments"
              :key="file.localId"
              class="flex flex-wrap items-center gap-2 rounded-[var(--radius-control)] border border-brand/30 bg-brand-soft px-3 py-2"
            >
              <span class="i-lucide-file-plus-2 text-brand" aria-hidden="true" />
              <span class="min-w-36 flex-1 truncate text-12px text-ink">{{ file.fileName }}</span>
              <input v-model="file.category" class="field-input h-7 w-32 text-11px" aria-label="附件分类">
              <button type="button" class="text-11px text-danger" @click="removePending(file.localId)">
                移除
              </button>
            </div>
          </div>
        </section>

        <section id="section-note" class="panel scroll-mt-4 p-4">
          <SectionHeader title="备注" />
          <textarea v-model="draft.note" rows="4" class="field-input w-full" placeholder="补充说明" />
        </section>

        <FormFooter
          v-model="closeAfterSave"
          :dirty="dirty"
          close-after-save
          :loading-action="loadingAction"
          @action="handleFooterAction"
        />
      </form>
    </main>
  </div>
</template>

<style scoped>
.form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 0.75rem 1rem;
  margin-top: 0.75rem;
}

.field-block {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 0.3rem;
}

.form-span-full {
  grid-column: 1 / -1;
}

.field-error {
  color: var(--danger);
  font-size: 11px;
  line-height: 1.3;
}
</style>
