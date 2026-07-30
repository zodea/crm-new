import { describe, expect, it } from 'vitest'
import { confirm, formModal, typeSelect, useKitUIHostState } from '~/composables/useKitUI'

// #86：confirm/formModal 被并发二次调用时，旧 promise 必须立即以 false/null 落定，
// 否则旧调用方的 await 永久卡死。此处直接驱动模块级原语 + 宿主解析函数验证抢占语义。
const {
  resolveConfirm,
  resolveFormModal,
  resolveTypeSelect,
  confirmState,
  formModalState,
  typeSelectState,
} = useKitUIHostState()

describe('#86 KitUI 并发二次调用抢占', () => {
  it('confirm 背靠背调用：旧 promise 立即以 false 落定，新调用照常工作', async () => {
    const p1 = confirm({ message: 'A' })
    const p2 = confirm({ message: 'B' }) // 抢占 p1
    await expect(p1).resolves.toBe(false)
    // p2 仍挂起，等宿主解析
    expect(confirmState.value).not.toBeNull()
    resolveConfirm(true)
    await expect(p2).resolves.toBe(true)
    expect(confirmState.value).toBeNull()
  })

  it('formModal 背靠背调用：旧 promise 立即以 null 落定，新调用照常工作', async () => {
    const p1 = formModal({ title: 'A', fields: [] })
    const p2 = formModal({ title: 'B', fields: [] }) // 抢占 p1
    await expect(p1).resolves.toBeNull()
    expect(formModalState.value).not.toBeNull()
    resolveFormModal({ name: '瑞航' })
    await expect(p2).resolves.toEqual({ name: '瑞航' })
    expect(formModalState.value).toBeNull()
  })

  it('单次正常调用不受影响：confirm 取消返回 false', async () => {
    const p = confirm({ message: '删除？' })
    resolveConfirm(false)
    await expect(p).resolves.toBe(false)
  })

  it('typeSelect 背靠背调用：旧 promise 立即以 null 落定，新调用返回所选 value', async () => {
    const options = [{ value: 'contract', label: '有合同付款' }]
    const p1 = typeSelect({ title: '第一次', options })
    const p2 = typeSelect({ title: '第二次', options })

    await expect(p1).resolves.toBeNull()
    expect(typeSelectState.value).not.toBeNull()
    resolveTypeSelect('contract')
    await expect(p2).resolves.toBe('contract')
    expect(typeSelectState.value).toBeNull()
  })

  it('typeSelect 与 confirm/formModal 状态可同时存在并分别落定', async () => {
    const typePromise = typeSelect({
      title: '选择类型',
      options: [{ value: 'company', label: '公司付款' }],
    })
    const confirmPromise = confirm({ message: '确认继续？' })
    const formPromise = formModal({ title: '补充信息', fields: [] })

    expect(typeSelectState.value).not.toBeNull()
    expect(confirmState.value).not.toBeNull()
    expect(formModalState.value).not.toBeNull()

    resolveConfirm(false)
    resolveFormModal(null)
    resolveTypeSelect(null)

    await expect(confirmPromise).resolves.toBe(false)
    await expect(formPromise).resolves.toBeNull()
    await expect(typePromise).resolves.toBeNull()
  })
})
