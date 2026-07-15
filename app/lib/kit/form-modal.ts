// KitUI formModal —— 字段配置驱动的表单弹窗的类型与纯校验逻辑
// 对照设计稿 kit/KitUI.jsx 的 formModal({ fields, onSave })，Vue 版返回 Promise。
// 纯逻辑抽到此处，便于 node 环境 vitest 直接断言（不依赖 DOM）。

export type FieldType = 'text' | 'number' | 'select' | 'textarea' | 'date'

export interface FieldDef {
  /** 提交值的键名 */
  key: string
  /** 字段标签 */
  label: string
  /** 控件类型，缺省 text */
  type?: FieldType
  /** 初始值 */
  value?: string | number | null
  /** type=select 的候选项 */
  options?: string[]
  /** 占位符 */
  placeholder?: string
  /** 必填校验 */
  required?: boolean
  /** 跨满整行（两列布局下占两格） */
  full?: boolean
}

export interface FormModalOptions {
  title?: string
  subtitle?: string
  fields: FieldDef[]
  /** 列数，缺省 1 */
  cols?: 1 | 2
  /** 保存按钮文案，缺省「保存」 */
  saveText?: string
  /** 弹窗宽度（px），缺省 480 */
  width?: number
}

export type FormValues = Record<string, string | number>

/** 用字段的初始值构造一份提交值草稿 */
export function initValues(fields: FieldDef[]): FormValues {
  const out: FormValues = {}
  for (const f of fields) {
    out[f.key] = f.value ?? (f.type === 'number' ? '' : '')
  }
  return out
}

/**
 * 纯校验：返回缺失的必填字段 key 列表。
 * 字符串按 trim 判空；数字（含 0）只要有值即算已填。
 */
export function findMissingRequired(fields: FieldDef[], values: FormValues): string[] {
  return fields
    .filter(f => f.required)
    .filter((f) => {
      const v = values[f.key]
      if (v == null)
        return true
      if (typeof v === 'string')
        return v.trim() === ''
      return Number.isNaN(v)
    })
    .map(f => f.key)
}
