import type { DataOriginDTO } from '../../types/read-model'
import type { SupplierFormDraft } from '../master-data/forms'
import type { SupplierFormReadDTO } from './command-contract'
import type { SupplierTaxpayerCommand, SupplierTaxpayerResult, TaxpayerVerificationDraft } from './taxpayer-verification'
import { computed, reactive, shallowRef } from 'vue'
import { supplierProblemFromUnknown } from './repository'

export interface TaxpayerEditorTarget { supplierId: string | null, origin: DataOriginDTO, version: string | null, draft: SupplierFormDraft, saved: SupplierFormDraft, enabled: boolean }
export function createTaxpayerEditorState(options: {
  target: () => TaxpayerEditorTarget
  pending: () => SupplierTaxpayerCommand | null
  execute: (input: { supplierId: string, origin: DataOriginDTO, expectedTaxNo: string, baseSupplierVersion: string, draft: TaxpayerVerificationDraft }, current: () => boolean) => Promise<SupplierTaxpayerResult>
  read: (id: string) => Promise<SupplierFormReadDTO>
  apply: (result: SupplierTaxpayerResult, verifiedTaxNo: string) => void
}) {
  const open = shallowRef(false)
  const active = shallowRef(true)
  const busy = shallowRef(false)
  const locked = shallowRef(false)
  const conflict = shallowRef(false)
  const error = shallowRef('')
  const summary = shallowRef('')
  const taxNo = shallowRef('')
  const form = reactive<TaxpayerVerificationDraft>({ status: 'confirmed_general', taxpayerType: '未核验', note: '' })
  let targetId = ''
  let version = ''
  let generation = 0
  let initial = ''
  const dirty = computed(() => open.value && (locked.value || JSON.stringify(form) !== initial))
  const canSubmit = computed(() => active.value && open.value && !busy.value && !conflict.value && Boolean(taxNo.value))
  function isCurrent(id: string, sequence: number) {
    const target = options.target()
    return active.value && sequence === generation && target.supplierId === id && target.origin === 'real' && target.enabled
  }
  function begin() {
    const target = options.target()
    if (!target.enabled || target.origin !== 'real' || !target.supplierId || !target.version)
      return '请先保存当前正式分供方，再记录人工核验结果'
    if (!(target.saved.taxNo ?? '').trim() || (target.draft.taxNo ?? '').trim() !== (target.saved.taxNo ?? '').trim())
      return '请先填写并保存当前税号，再记录人工核验结果；其他未保存输入会保留'
    generation++
    targetId = target.supplierId
    version = target.version
    taxNo.value = (target.saved.taxNo ?? '').trim()
    Object.assign(form, { status: 'confirmed_general', taxpayerType: target.draft.taxpayerType || '未核验', note: '' })
    initial = JSON.stringify(form)
    open.value = true
    error.value = ''
    summary.value = ''
    conflict.value = false
    busy.value = false
    locked.value = options.pending() !== null
    return ''
  }
  async function save() {
    if (!canSubmit.value)
      return false
    const sequence = generation
    const id = targetId
    const target = options.target()
    if (!locked.value && (target.draft.taxNo ?? '').trim() !== (target.saved.taxNo ?? '').trim()) {
      error.value = '主档税号还有未保存修改，请先保存税号'
      return false
    }
    busy.value = true
    error.value = ''
    try {
      const result = await options.execute({ supplierId: id, origin: 'real', expectedTaxNo: taxNo.value, baseSupplierVersion: version, draft: { ...form } }, () => isCurrent(id, sequence))
      if (!isCurrent(id, sequence))
        return false
      options.apply(result, taxNo.value)
      locked.value = false
      open.value = false
      return true
    }
    catch (cause) {
      if (isCurrent(id, sequence)) {
        const problem = supplierProblemFromUnknown(cause)
        error.value = problem.message
        conflict.value = problem.problem.code === 'conflict'
      }
      return false
    }
    finally {
      if (sequence === generation) {
        locked.value = options.pending() !== null
        busy.value = false
      }
    }
  }
  async function recheck() {
    if (!active.value || !open.value || busy.value || locked.value)
      return
    const sequence = generation
    const id = targetId
    busy.value = true
    try {
      const latest = await options.read(id)
      if (!isCurrent(id, sequence))
        return
      if (!latest.draft.taxNo?.trim())
        throw new Error('当前主档未保存税号，请先完成主档')
      version = latest.version
      taxNo.value = latest.draft.taxNo.trim()
      summary.value = `已重新读取 ${latest.draft.name || '当前分供方'}，税号 ${taxNo.value}。请按此税号重新核对结果；主档其他未保存输入仍保留，后续保存主档时仍会检查版本。`
      conflict.value = false
      error.value = ''
    }
    catch (cause) {
      if (isCurrent(id, sequence))
        error.value = cause instanceof Error ? cause.message : '重新读取失败'
    }
    finally {
      if (sequence === generation)
        busy.value = false
    }
  }
  function close() {
    if (busy.value)
      return false
    // 不确定提交必须保留原身份；关闭仅暂时收起，不能把它改成新提交。
    if (locked.value)
      return false
    generation++
    open.value = false
    return true
  }
  function deactivate() {
    active.value = false
    generation++
    busy.value = false
    locked.value = options.pending() !== null
  }
  function activate() {
    active.value = true
  }
  return { open, active, busy, locked, conflict, error, summary, taxNo, form, dirty, canSubmit, begin, save, recheck, close, deactivate, activate }
}
