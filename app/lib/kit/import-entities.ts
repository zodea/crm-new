import type { ImportTemplateField } from './import-mapping'
import type { Invoice } from '~/stores/invoice'
import { getInvoiceImportSourceMeta, invoiceNaturalKey } from '~/lib/invoice/excel'
import {
  QUANTITY_ASSIGNMENT_IMPORT_FIELDS,
  QUANTITY_COMPLETION_IMPORT_FIELDS,
  QUANTITY_LEGACY_PRECHECK_FIELDS,
  QUANTITY_TEMPLATE_IMPORT_FIELDS,
} from '~/lib/quantity/import'
import { normalizeSupplierImportRow } from '~/lib/supplier/import'
import { round2 } from '~/lib/util/number'
import { useBrowserQuantityStore } from '~/stores/quantity-browser'
import { MATERIAL_CONTRACT_LINE_IMPORT_FIELDS } from '../material-contract/import'
import { EXTERNAL_REF_FIELD } from './import-mapping'

// 工程量三类目标（#103 切片 6B）：逐行交给工程量中央导入，行内自带项目编码定位归属。
async function runQuantityImport(
  row: Record<string, unknown>,
  target: 'template' | 'assignment' | 'completion',
): Promise<void> {
  await useBrowserQuantityStore().importRow(target, row)
}

// 导入实体注册表（ADR 0005「实体触发、模板隐含」）：
// 实体键即 /import/mapping/:entity 路由参数，静态登记保证刷新后仍可解析。
// 项目与分供方走中央命令；其他实体仍按各自现行接管边界处理。

export interface ImportEntityDef {
  key: string
  label: string
  fields: readonly ImportTemplateField[]
  /** 返回可预期的业务拒绝原因；瞬时写入故障仍由 importRow 抛出并停在当前行。 */
  validateRow?: (row: Record<string, unknown>) => string | null | undefined | Promise<string | null | undefined>
  /** 逐行入库；抛错即导入步失败，重试从失败行续导。 */
  importRow: (row: Record<string, unknown>) => Promise<void>
}

const DEMO_SUPPLIER_FIELDS: readonly ImportTemplateField[] = [
  { key: 'name', label: '名称', required: true, aliases: ['分供方名称', '供应商名称'] },
  { key: 'category', label: '合作类别', required: true, aliases: ['类别'] },
  { key: 'contact', label: '联系人' },
  { key: 'phone', label: '联系电话', aliases: ['手机号'] },
  EXTERNAL_REF_FIELD,
]

// 演示瞬时故障：外部旧ID 以 FAIL 开头的行首次写入失败、重试成功，
// 用于跑通「失败保留页签 → 从失败行续导」旅程。
const demoFailedOnce = new Set<string>()

// 项目导入客户字段先唯一解析为真实 ID，拒绝继续写已停用的 developer/developer2 文本列。
const PROJECT_FIELDS: readonly ImportTemplateField[] = [
  { key: 'name', label: '项目名称', required: true, aliases: ['项目', '工程名称'] },
  { key: 'contractName', label: '项目合同名称', aliases: ['合同名称'] },
  { key: 'customerName', label: '客户', required: true, aliases: ['甲方', '建设单位', '客户（甲方）'] },
  { key: 'secondaryCustomerName', label: '次客户', aliases: ['客户2', '次甲方'] },
  { key: 'operationType', label: '经营类型', aliases: ['经营分类'] },
  { key: 'status', label: '业务流程阶段', aliases: ['项目状态', '阶段', '状态'] },
  { key: 'region', label: '工程地域', aliases: ['地域', '所在地区'] },
  { key: 'address', label: '工程详细地址', aliases: ['项目地址', '地址', '详细地址'] },
  { key: 'manager', label: '项目经理', required: true, aliases: ['负责人'] },
  { key: 'execManager', label: '执行经理' },
  { key: 'builder', label: '施工员' },
  { key: 'startDate', label: '计划开工', aliases: ['开工日期', '计划开工日期'] },
  { key: 'plannedEnd', label: '计划竣工', aliases: ['竣工日期', '计划竣工日期'] },
  { key: 'note', label: '备注' },
  EXTERNAL_REF_FIELD,
]

const SUPPLIER_FIELDS: readonly ImportTemplateField[] = [
  { key: 'name', label: '公司全称', required: true, aliases: ['分供方名称', '供应商名称', '名称'] },
  { key: 'supplierCategory', label: '分供方类别', aliases: ['类别', '合作类别'] },
  { key: 'aliases', label: '简称/别名', aliases: ['简称', '别名'] },
  { key: 'uniqueCode', label: '唯一识别码', aliases: ['分供方内部编码', '内部编码'] },
  { key: 'taxNo', label: '统一社会信用代码', aliases: ['税号', '纳税人识别号', '信用代码'] },
  { key: 'legalRep', label: '法定代表人', aliases: ['法人'] },
  { key: 'registeredCapital', label: '注册资金（万元）', aliases: ['注册资金', '注册资本'] },
  { key: 'registeredDate', label: '注册日期', aliases: ['成立日期'] },
  { key: 'address', label: '注册地址', aliases: ['地址'] },
  { key: 'mainBusiness', label: '主营业务' },
  { key: 'laborScope', label: '劳务承包范围' },
  { key: 'businessType', label: '经营类型' },
  { key: 'invoiceName', label: '开票名称' },
  { key: 'taxpayerType', label: '纳税人类型' },
  { key: 'bank', label: '开户行' },
  { key: 'bankAccount', label: '银行账号' },
  { key: 'invoiceAddress', label: '开票地址' },
  { key: 'phone', label: '电话' },
  { key: 'contact', label: '主要联系人', aliases: ['联系人'] },
  { key: 'contactPhone', label: '联系方式', aliases: ['联系电话', '手机号'] },
  { key: 'rating', label: '评价等级' },
  { key: 'note', label: '备注' },
  EXTERNAL_REF_FIELD,
]

const INVOICE_FIELDS: readonly ImportTemplateField[] = [
  { key: 'invoiceNumber', label: '发票号码', required: true, aliases: ['发票号', '单据编号', '票号'] },
  { key: 'invoiceDate', label: '发票日期', aliases: ['开票日期', '日期'] },
  { key: 'seller', label: '供应商', aliases: ['公司名称', '开票单位'] },
  { key: 'buyer', label: '购买方', aliases: ['购方', '购买单位'] },
  { key: 'totalAmount', label: '价税合计', required: true, aliases: ['金额', '含税金额', '总金额'] },
  { key: 'taxAmount', label: '税额' },
  { key: 'invoiceType', label: '票据类型', aliases: ['发票类型', '类型'] },
  { key: 'projectName', label: '归属项目', aliases: ['使用工地', '项目', '对应项目'] },
  { key: 'remark', label: '备注' },
  EXTERNAL_REF_FIELD,
]

const PERSONAL_OWNER_VALUES = new Set(['个人', '个人开支', '个人费用'])

function importText(value: unknown): string {
  return String(value ?? '').trim()
}

function importAmount(value: unknown, label: string): number {
  const text = importText(value).replace(/[￥¥,\s]/g, '')
  if (!text)
    return 0
  const amount = Number(text)
  if (!Number.isFinite(amount))
    throw new Error(`${label}不是有效金额：${text}`)
  return round2(amount)
}

function invoiceDataFromRow(row: Record<string, unknown>) {
  const totalAmount = importAmount(row.totalAmount, '价税合计')
  const taxAmount = importAmount(row.taxAmount, '税额')
  return {
    invoiceNumber: importText(row.invoiceNumber),
    invoiceDate: importText(row.invoiceDate),
    seller: importText(row.seller),
    buyer: importText(row.buyer),
    totalAmount,
    taxAmount,
    amount: round2(totalAmount - taxAmount),
    invoiceType: importText(row.invoiceType) || '增值税普通发票',
    projectName: importText(row.projectName),
    remark: importText(row.remark),
  }
}

function invoiceImportValidationError(
  data: ReturnType<typeof invoiceDataFromRow>,
  projectNames: readonly string[],
): string | null {
  if (!data.invoiceNumber)
    return '发票号码不能为空'
  if (data.totalAmount <= 0)
    return '价税合计不能为空或必须大于 0'
  if (!data.projectName)
    return '缺归属：请填写对应项目；个人开支请填写“个人开支”'

  if (PERSONAL_OWNER_VALUES.has(data.projectName))
    return null

  const matches = projectNames.filter(name => name === data.projectName)
  if (matches.length !== 1)
    return `缺归属：项目“${data.projectName}”未唯一匹配到有效项目`
  return null
}

export const IMPORT_ENTITIES: Readonly<Record<string, ImportEntityDef>> = {
  'invoice': {
    key: 'invoice',
    label: '发票台账',
    fields: INVOICE_FIELDS,
    async validateRow(row) {
      const projectStore = useProjectStore()
      if (!projectStore.list.length)
        await projectStore.load()
      try {
        const sourceReview = getInvoiceImportSourceMeta(row)?.reviewReasons ?? []
        if (sourceReview.length)
          return `来源复核：${sourceReview.join('；')}`
        const invoiceStore = useInvoiceStore()
        if (!invoiceStore.list.length)
          await invoiceStore.load()
        const naturalKey = invoiceNaturalKey(row)
        if (naturalKey && invoiceStore.list.some(invoice => invoiceNaturalKey({ invoiceNumber: invoice.invoiceNumber }) === naturalKey))
          return `发票号码已存在：${String(row.invoiceNumber).trim()}，请逐行复核后再导入`
        return invoiceImportValidationError(
          invoiceDataFromRow(row),
          projectStore.list.map(project => project.name),
        )
      }
      catch (cause) {
        return cause instanceof Error ? cause.message : '发票字段格式无效'
      }
    },
    async importRow(row) {
      const invoiceStore = useInvoiceStore()
      const projectStore = useProjectStore()
      if (!invoiceStore.list.length)
        await invoiceStore.load()
      if (!projectStore.list.length)
        await projectStore.load()

      const data = invoiceDataFromRow(row)
      const validationError = invoiceImportValidationError(
        data,
        projectStore.list.map(project => project.name),
      )
      if (validationError)
        throw new Error(validationError)

      const isPersonal = PERSONAL_OWNER_VALUES.has(data.projectName)

      const project = isPersonal
        ? []
        : projectStore.list.filter(item => item.name === data.projectName)
      if (!isPersonal && project.length !== 1)
        throw new Error(`归属项目“${data.projectName}”未唯一匹配到有效项目`)

      const existing = invoiceStore.list.find(invoice => invoice.invoiceNumber === data.invoiceNumber)
      const current = existing as unknown as Invoice | undefined
      const incoming = {
        ...data,
        projectName: isPersonal ? '个人开支' : project[0]!.name,
        projectId: isPersonal ? null : project[0]!.id,
        ownerKind: isPersonal ? 'personal' as const : 'project' as const,
      }

      if (existing) {
        const patch: Partial<Invoice> = {}
        for (const key of ['invoiceDate', 'seller', 'buyer', 'invoiceType', 'projectName', 'remark'] as const) {
          if (!current![key] && incoming[key])
            patch[key] = incoming[key]
        }
        if (!current!.totalAmount && incoming.totalAmount)
          patch.totalAmount = incoming.totalAmount
        if (!current!.taxAmount && incoming.taxAmount)
          patch.taxAmount = incoming.taxAmount
        if (!current!.amount && incoming.amount)
          patch.amount = incoming.amount
        if (!current!.projectId && incoming.projectId)
          patch.projectId = incoming.projectId
        if (!current!.ownerKind && incoming.ownerKind)
          patch.ownerKind = incoming.ownerKind
        if (Object.keys(patch).length)
          await invoiceStore.update(current!.id, { ...current!, ...patch })
        return
      }

      await invoiceStore.add({
        ...incoming,
        source: 'excel',
        ocrStatus: 'done',
        reviewStatus: 'reviewed',
        accountStatus: 'none',
        dupStatus: 'normal',
        ownerKind: incoming.ownerKind,
        fileName: '',
        filePath: '',
        fileSize: '',
        pageCount: 0,
      })
    },
  },
  'project': {
    key: 'project',
    label: '施工项目',
    fields: PROJECT_FIELDS,
    validateRow: row => useProjectCommandStore().validateImportRow(row),
    async importRow(row) {
      await useProjectCommandStore().importRow(row)
    },
  },
  'supplier': {
    key: 'supplier',
    label: '分供方',
    fields: SUPPLIER_FIELDS,
    async validateRow(row) {
      try {
        normalizeSupplierImportRow(row)
        return null
      }
      catch (cause) {
        return cause instanceof Error ? cause.message : '分供方导入内容无效'
      }
    },
    async importRow(row) {
      await useSupplierCommandStore().importRow(row)
    },
  },
  'demo-supplier': {
    key: 'demo-supplier',
    label: '演示·分供方',
    fields: DEMO_SUPPLIER_FIELDS,
    async importRow(row) {
      await new Promise(resolve => setTimeout(resolve, 60))
      const externalRef = String(row.externalRef ?? '')
      if (externalRef.startsWith('FAIL') && !demoFailedOnce.has(externalRef)) {
        demoFailedOnce.add(externalRef)
        throw new Error(`演示写入失败：${externalRef}`)
      }
    },
  },
  'quantity-template': {
    key: 'quantity-template',
    label: '工程量·户型模板量',
    fields: QUANTITY_TEMPLATE_IMPORT_FIELDS,
    importRow: row => runQuantityImport(row, 'template'),
  },
  'quantity-assignment': {
    key: 'quantity-assignment',
    label: '工程量·责任配置',
    fields: QUANTITY_ASSIGNMENT_IMPORT_FIELDS,
    importRow: row => runQuantityImport(row, 'assignment'),
  },
  'quantity-completion': {
    key: 'quantity-completion',
    label: '工程量·阶段完成',
    fields: QUANTITY_COMPLETION_IMPORT_FIELDS,
    importRow: row => runQuantityImport(row, 'completion'),
  },
  'quantity-legacy-precheck': {
    key: 'quantity-legacy-precheck',
    label: '工程量·旧合一行迁移预检（不写入）',
    fields: QUANTITY_LEGACY_PRECHECK_FIELDS,
    // 预检只读校验：行成功 = 可迁移，行失败原因即预检报告；绝不写库。
    async importRow(row) {
      const [{ withTransaction }, { precheckQuantityLegacyRow }] = await Promise.all([
        import('~/lib/db/connection'),
        import('~/lib/quantity/import'),
      ])
      await withTransaction(tx => precheckQuantityLegacyRow(tx, row))
    },
  },
}

export function getImportEntity(key: string): ImportEntityDef | undefined {
  // hasOwn 守卫：路由参数可为任意字符串（如 constructor），不得沿原型链误命中。
  return Object.hasOwn(IMPORT_ENTITIES, key) ? IMPORT_ENTITIES[key] : undefined
}

/** 当前合同草稿整批追加的模板登记；正式保存由合同命令负责。 */
export const DRAFT_IMPORT_TEMPLATES = {
  'material-contract-lines': { key: 'material-contract-lines', label: '材料采购合同明细', fields: MATERIAL_CONTRACT_LINE_IMPORT_FIELDS },
} as const
