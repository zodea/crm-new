import type { SupplierFormDraft } from '~/lib/master-data/forms'
import type { SupplierTaxpayerCommand, SupplierTaxpayerResult } from '~/lib/supplier/taxpayer-verification'
import { describe, expect, it, vi } from 'vitest'
import { credentialProblem } from '~/lib/supplier/credential-contract'
import { createTaxpayerEditorState } from '~/lib/supplier/taxpayer-editor-state'
import { mergeTaxpayerVerification } from '~/lib/supplier/taxpayer-verification'

const verification = { taxpayerType: '未核验', taxpayerVerificationStatus: 'not_found', taxpayerVerificationSource: '官网', taxpayerVerifiedAt: '2026-09-12T12:00:00.000Z', taxpayerVerificationNote: '未查到' }
const result: SupplierTaxpayerResult = { commandId: 'command', supplierId: 'supplier-a', supplierVersion: '2', credentialVersion: '1', credentialId: null, auditId: 'audit', deletionToken: null, verification }
function setup() {
  const target = { supplierId: 'supplier-a' as string | null, origin: 'real' as 'real' | 'demo', version: '1', draft: { taxNo: 'TAX-A', note: '未保存备注' } as SupplierFormDraft, saved: { taxNo: 'TAX-A', note: '原备注' } as SupplierFormDraft, enabled: true }
  let pending: SupplierTaxpayerCommand | null = null
  const execute = vi.fn().mockResolvedValue(result)
  const read = vi.fn().mockResolvedValue({ draft: { id: 'supplier-a', name: '合成分供方', taxNo: 'TAX-A' }, version: '3' })
  const apply = vi.fn((result: SupplierTaxpayerResult) => {
    const merged = mergeTaxpayerVerification(target.draft, target.saved, result.verification)
    target.draft = merged.draft
    target.saved = merged.saved
  })
  const state = createTaxpayerEditorState({ target: () => target, pending: () => pending, execute, read, apply })
  return { target, state, execute, read, apply, setPending: (value: SupplierTaxpayerCommand | null) => {
    pending = value
  } }
}

describe('税务核验编辑稿和主档基准', () => {
  it('成功只修补已保存五字段，主档备注原稿与脏基准仍不同', async () => {
    const { state, target } = setup()
    expect(state.begin()).toBe('')
    state.form.status = 'not_found'
    state.form.note = '未查到'
    expect(await state.save()).toBe(true)
    expect(target.draft).toMatchObject({ ...verification, taxNo: 'TAX-A', note: '未保存备注' })
    expect(target.saved).toMatchObject({ ...verification, note: '原备注' })
    expect(state.open.value).toBe(false)
  })
  it('失败和陈旧版本保留核验备注，显式重读后才允许继续', async () => {
    const { state, execute } = setup()
    state.begin()
    state.form.note = '保留人工备注'
    execute.mockRejectedValueOnce(credentialProblem('conflict', '已变化'))
    expect(await state.save()).toBe(false)
    expect(state.open.value).toBe(true)
    expect(state.form.note).toBe('保留人工备注')
    expect(state.canSubmit.value).toBe(false)
    await state.recheck()
    expect(state.canSubmit.value).toBe(true)
    expect(state.form.note).toBe('保留人工备注')
    await state.save()
    expect(execute.mock.calls[1]![0].baseSupplierVersion).toBe('3')
  })
  it('切换页签保稿，迟到核验不修改其他主体；回原页可恢复', async () => {
    const { state, execute, target, apply } = setup()
    state.begin()
    state.form.note = 'A 的输入'
    let finish!: (result: SupplierTaxpayerResult) => void
    execute.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const saving = state.save()
    state.deactivate()
    target.supplierId = 'supplier-b'
    finish(result)
    await saving
    expect(apply).not.toHaveBeenCalled()
    expect(state.form.note).toBe('A 的输入')
    target.supplierId = 'supplier-a'
    state.activate()
    expect(state.open.value).toBe(true)
  })
  it('新建、演示和未保存税号均不发核验写入', async () => {
    const { state, target, execute } = setup()
    target.supplierId = null
    expect(state.begin()).toContain('先保存')
    target.supplierId = 'supplier-a'
    target.origin = 'demo'
    expect(state.begin()).toContain('正式')
    target.origin = 'real'
    target.draft.taxNo = 'UNSAVED'
    expect(state.begin()).toContain('保存当前税号')
    expect(execute).not.toHaveBeenCalled()
  })
  it.each(['save', 'recheck'] as const)('迟到 A 的 %s finally 不解除 B 的提交锁或接受重复点击', async (operation) => {
    const { state, execute, read, target, apply } = setup()
    state.begin()
    let finishA!: (value: any) => void
    let finishB!: (value: SupplierTaxpayerResult) => void
    if (operation === 'save') {
      execute.mockImplementationOnce(() => new Promise((resolve) => {
        finishA = resolve
      }))
    }
    else {
      read.mockImplementationOnce(() => new Promise((resolve) => {
        finishA = resolve
      }))
    }
    const awaitingA = operation === 'save' ? state.save() : state.recheck()
    expect(state.busy.value).toBe(true)
    state.deactivate()
    expect(state.busy.value).toBe(false)
    target.supplierId = 'supplier-b'
    target.draft.taxNo = target.saved.taxNo = 'TAX-B'
    state.activate()
    expect(state.begin()).toBe('')
    execute.mockImplementationOnce(() => new Promise((resolve) => {
      finishB = resolve
    }))
    const savingB = state.save()
    const calls = execute.mock.calls.length
    finishA(operation === 'save' ? result : { draft: { id: 'supplier-a', taxNo: 'TAX-A' }, version: '9' })
    await awaitingA
    expect(state.busy.value).toBe(true)
    expect(state.canSubmit.value).toBe(false)
    expect(state.taxNo.value).toBe('TAX-B')
    expect(await state.save()).toBe(false)
    expect(execute).toHaveBeenCalledTimes(calls)
    expect(apply).not.toHaveBeenCalled()
    finishB({ ...result, supplierId: 'supplier-b' })
    await savingB
    expect(state.busy.value).toBe(false)
    expect(apply).toHaveBeenCalledOnce()
  })

  it('停用即时保留原未知命令锁，不删除原编号或迟到改写下一代状态', async () => {
    const { state, execute, setPending } = setup()
    state.begin()
    const pending = { commandId: 'original-taxpayer-command', supplierId: 'supplier-a' } as SupplierTaxpayerCommand
    let finish!: (value: SupplierTaxpayerResult) => void
    execute.mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve
    }))
    const saving = state.save()
    setPending(pending)
    state.deactivate()
    expect(state.locked.value).toBe(true)
    expect(state.busy.value).toBe(false)
    expect(state.close()).toBe(false)
    finish(result)
    await saving
    expect(state.locked.value).toBe(true)
    state.activate()
    expect(state.begin()).toBe('')
    expect(state.locked.value).toBe(true)
  })
})
