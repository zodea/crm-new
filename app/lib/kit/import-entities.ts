import type { ImportTemplateField } from './import-mapping'
import { EXTERNAL_REF_FIELD } from './import-mapping'

// 导入实体注册表（ADR 0005「实体触发、模板隐含」）：
// 实体键即 /import/mapping/:entity 路由参数，静态登记保证刷新后仍可解析。
// 本片（#81）只带 stub 演示实体；各实体真实模板字段是 #73 的数据任务，后续波次在此登记。

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

export const IMPORT_ENTITIES: Readonly<Record<string, ImportEntityDef>> = {
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
}

export function getImportEntity(key: string): ImportEntityDef | undefined {
  // hasOwn 守卫：路由参数可为任意字符串（如 constructor），不得沿原型链误命中。
  return Object.hasOwn(IMPORT_ENTITIES, key) ? IMPORT_ENTITIES[key] : undefined
}
