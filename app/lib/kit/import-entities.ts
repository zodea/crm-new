import type { ImportTemplateField } from './import-mapping'
import type { Project } from '~/stores/project'
import { normalizeProjectStatus } from '~/lib/project/status'
import {
  QUANTITY_ASSIGNMENT_IMPORT_FIELDS,
  QUANTITY_COMPLETION_IMPORT_FIELDS,
  QUANTITY_LEGACY_PRECHECK_FIELDS,
  QUANTITY_TEMPLATE_IMPORT_FIELDS,
} from '~/lib/quantity/import'
import { normalizeSupplierImportRow } from '~/lib/supplier/import'
import { EXTERNAL_REF_FIELD } from './import-mapping'

// 工程量三类目标（#103 切片 6B）：逐行复用领域唯一写路径，行内自带项目编码定位归属；
// connection 依赖 Tauri 运行时，因此在 importRow 内动态加载，保持本文件纯 node 可解析。
async function runQuantityImport(
  row: Record<string, unknown>,
  handler: 'importQuantityTemplateRow' | 'importQuantityAssignmentRow' | 'importQuantityCompletionRow',
): Promise<void> {
  const [{ withTransaction }, quantityImport] = await Promise.all([
    import('~/lib/db/connection'),
    import('~/lib/quantity/import'),
  ])
  await withTransaction(tx => quantityImport[handler](tx, row))
}

// 导入实体注册表（ADR 0005「实体触发、模板隐含」）：
// 实体键即 /import/mapping/:entity 路由参数，静态登记保证刷新后仍可解析。
// demo-supplier 为演示 stub；project 为第一个真实实体（#58 从项目列表页 openImportTab
// 触发，模板字段取 #73 项目分析，逐行经 store.add 真实入库并落 create 日志）。
// importRow 内的 useProjectStore 是 Nuxt 自动导入的运行时值：仅浏览器内导入 runner 调用，
// node 单测不触发（故本文件仍可在纯 node 环境解析——Project 为 type-only import，运行时擦除）。

export interface ImportEntityDef {
  key: string
  label: string
  fields: readonly ImportTemplateField[]
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

// 项目导入模板字段（#73 项目分析，字段 key = Project 字段名，故映射后的行可直接入库）。
const PROJECT_FIELDS: readonly ImportTemplateField[] = [
  { key: 'name', label: '项目名称', required: true, aliases: ['项目', '工程名称'] },
  { key: 'contractName', label: '项目合同名称', aliases: ['合同名称'] },
  { key: 'developer', label: '客户', aliases: ['甲方', '建设单位', '客户（甲方）'] },
  { key: 'operationType', label: '经营类型', aliases: ['经营分类'] },
  { key: 'status', label: '业务流程阶段', aliases: ['项目状态', '阶段', '状态'] },
  { key: 'region', label: '工程地域', aliases: ['地域', '所在地区'] },
  { key: 'address', label: '工程详细地址', aliases: ['项目地址', '地址', '详细地址'] },
  { key: 'manager', label: '项目经理', aliases: ['负责人'] },
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
  { key: 'credentialStatus', label: '资料状态', aliases: ['资质状态'] },
  { key: 'aliases', label: '简称/别名', aliases: ['简称', '别名'] },
  { key: 'uniqueCode', label: '统一社会信用代码', aliases: ['信用代码'] },
  { key: 'taxNo', label: '税号', aliases: ['纳税人识别号'] },
  { key: 'legalRep', label: '法定代表人', aliases: ['法人'] },
  { key: 'registeredCapital', label: '注册资金（万元）', aliases: ['注册资金', '注册资本'] },
  { key: 'registeredDate', label: '注册日期', aliases: ['成立日期'] },
  { key: 'address', label: '注册地址', aliases: ['地址'] },
  { key: 'mainBusiness', label: '主营业务' },
  { key: 'businessType', label: '业务类型' },
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

export const IMPORT_ENTITIES: Readonly<Record<string, ImportEntityDef>> = {
  'project': {
    key: 'project',
    label: '施工项目',
    fields: PROJECT_FIELDS,
    // 逐行入库：字段 key 与 Project 字段同名，映射后的行即 Partial<Project>；store.add
    // 内部走 INSERT + logCreate + load，导入完成后新行经共享 store 出现在列表页。
    // externalRef 等未登记列由 projectToBindings 忽略（只写 PROJECT_COLUMN_KEYS）。
    // status 经 normalizeProjectStatus 归一：Excel 任意文本不得写进非法阶段值。
    async importRow(row) {
      await useProjectStore().add({
        ...row,
        status: normalizeProjectStatus(row.status),
      } as Partial<Project>)
    },
  },
  'supplier': {
    key: 'supplier',
    label: '分供方',
    fields: SUPPLIER_FIELDS,
    async importRow(row) {
      await useSupplierStore().upsertImported(normalizeSupplierImportRow(row))
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
    importRow: row => runQuantityImport(row, 'importQuantityTemplateRow'),
  },
  'quantity-assignment': {
    key: 'quantity-assignment',
    label: '工程量·责任配置',
    fields: QUANTITY_ASSIGNMENT_IMPORT_FIELDS,
    importRow: row => runQuantityImport(row, 'importQuantityAssignmentRow'),
  },
  'quantity-completion': {
    key: 'quantity-completion',
    label: '工程量·阶段完成',
    fields: QUANTITY_COMPLETION_IMPORT_FIELDS,
    importRow: row => runQuantityImport(row, 'importQuantityCompletionRow'),
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
