import type { SupplierCredentialCommand, SupplierCredentialRecognition, SupplierCredentialRepository, SupplierCredentialSnapshot } from '~/lib/supplier/credential-contract'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { credentialProblem, SupplierCredentialNotAppliedProblem } from '~/lib/supplier/credential-contract'
import { parseCredentialOcr } from '~/lib/supplier/credential-ocr'
import { createSupplierCredentialState } from '~/lib/supplier/credential-state'
import SupplierCredentialOcrWorkflow from '~/pages/base/supplier/credential/_components/SupplierCredentialOcrWorkflow.vue'
import { credentialRecord, credentialSnapshot } from '../supplier/credential-ui-fixtures'

const settings = vi.hoisted(() => ({ load: vi.fn(), recognitionOptions: { useDocUnwarping: true } }))
vi.mock('~/stores/ocr-settings', () => ({ useOcrSettingsStore: () => settings }))
const confirm = vi.fn()
const read = vi.fn<SupplierCredentialRepository['read']>()
const execute = vi.fn<SupplierCredentialRepository['execute']>()

function recognition(id = 'recognition-a', name = 'OCR 公司'): SupplierCredentialRecognition {
  const result = { engine: 'paddleocr-official-api' as const, model: 'PaddleOCR-VL-1.6' as const, jobId: id, pages: [], markdownPages: [`营业执照\n名称：${name}`], dataInfo: {} }
  return { id, fileId: 'file-a', sha256: 'a'.repeat(64), recognizedAt: '2026-09-12T08:00:00Z', result, parsed: parseCredentialOcr(result) }
}
function snapshot(overrides: Partial<SupplierCredentialSnapshot> = {}) {
  return credentialSnapshot({ capabilities: ['supplier-credential:read', 'supplier-credential:write', 'supplier:write'], masterValues: { name: '当前公司', taxNo: '当前税号', uniqueCode: 'INTERNAL' }, credentials: [credentialRecord({ recognition: recognition(), ocrReviewStatus: 'pending', validFrom: '2024-01-01', expiresAt: '2030-01-01' })], ...overrides })
}
async function setup(initial = snapshot(), recognizeOnOpen = false) {
  read.mockResolvedValue(initial)
  const target = reactive({ supplierId: initial.supplierId, origin: initial.dataOrigin, enabled: true })
  let count = 0
  const session = createSupplierCredentialState({ read, execute, file: vi.fn() }, () => target, () => `command-${++count}`)
  await session.load()
  const view = render(SupplierCredentialOcrWorkflow, { props: { session, credentialId: 'credential-a', active: true, recognizeOnOpen } })
  await screen.findByRole('dialog', { name: '证照识别与人工核对' })
  return { ...view, session, target }
}
async function enterManualName(value = '人工输入保留') {
  await fireEvent.click(within(screen.getByRole('group', { name: '公司名称' })).getByRole('radio', { name: '手工修改' }))
  await fireEvent.update(screen.getByLabelText('公司名称手工确认值'), value)
}
function result(command: SupplierCredentialCommand) {
  return { commandId: command.commandId, supplierId: command.supplierId, credentialId: 'credential-a', auditId: 'audit-a', deletionToken: null, supplierVersion: 's2', credentialVersion: 'c2' }
}
beforeEach(() => {
  settings.load.mockReset().mockResolvedValue(undefined)
  confirm.mockReset().mockResolvedValue(false)
  read.mockReset()
  execute.mockReset().mockImplementation(async command => result(command))
  vi.stubGlobal('useKitUI', () => ({ confirm }))
})
afterEach(() => vi.unstubAllGlobals())

describe('中央 OCR 识别与人工确认工作流', () => {
  it('识别明确未应用可重试或关闭，结果未知时遇撤权仍保原提交恢复入口', async () => {
    execute.mockImplementationOnce(async (command) => {
      throw new SupplierCredentialNotAppliedProblem(command.commandId, '未配置服务，原件保留')
    })
    const { emitted } = await setup(snapshot({ credentials: [credentialRecord()] }), true)
    await screen.findByText('未配置服务，原件保留')
    expect(screen.queryByRole('button', { name: '恢复原提交' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }))
    await waitFor(() => expect(emitted().close).toHaveLength(1))
  })
  it('识别使用已有设置，等待期间关闭无效；候选持久化后稍后核对不触发确认', async () => {
    let complete!: () => void
    execute.mockImplementationOnce(command => new Promise((resolve) => {
      complete = () => resolve(result(command))
    }))
    const { emitted } = await setup(snapshot({ credentials: [credentialRecord()] }), true)
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const close = screen.getByRole('button', { name: '关闭', exact: true })
    await waitFor(() => expect(document.activeElement).toBe(close))
    await fireEvent.click(close)
    await fireEvent.keyDown(close, { key: 'Escape' })
    expect(emitted().close).toBeUndefined()
    expect(confirm).not.toHaveBeenCalled()
    expect(execute.mock.calls[0]![0]).toMatchObject({ action: 'ocr-recognize', options: settings.recognitionOptions })
    read.mockResolvedValue(snapshot())
    complete()
    await screen.findByRole('button', { name: '保存核对结果' })
    await fireEvent.click(screen.getByRole('button', { name: '稍后核对' }))
    await waitFor(() => expect(emitted().close).toHaveLength(1))
    expect(execute).toHaveBeenCalledTimes(1)
    expect(confirm).not.toHaveBeenCalled()
  })

  it('冷读取候选可直接核对，显示真实日期当前值，先聚焦关闭且不自动确认', async () => {
    await setup()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '关闭', exact: true })))
    expect(within(screen.getByRole('group', { name: '生效日期' })).getByText('2024-01-01')).toBeTruthy()
    expect(within(screen.getByRole('group', { name: '到期日期' })).getByText('2030-01-01')).toBeTruthy()
    expect(execute).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute.mock.calls[0]![0]).toMatchObject({ action: 'ocr-confirm', draft: { recognitionId: 'recognition-a', choices: expect.arrayContaining([{ key: 'validFrom', decision: 'keep-current' }, { key: 'expiresAt', decision: 'keep-current' }]) } })
  })

  it('确认响应丢失保留并冻结原选择，恢复携带完全相同的原命令', async () => {
    const { emitted, session } = await setup()
    await enterManualName()
    execute.mockRejectedValueOnce(credentialProblem('unavailable', '响应丢失'))
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    await screen.findByRole('button', { name: '恢复原提交' })
    const input = screen.getByLabelText('公司名称手工确认值') as HTMLInputElement
    expect(input.value).toBe('人工输入保留')
    expect(input.closest('fieldset[disabled]')).not.toBeNull()
    confirm.mockResolvedValueOnce(true)
    await fireEvent.click(screen.getByRole('button', { name: '关闭', exact: true }))
    expect(confirm).not.toHaveBeenCalled()
    expect(emitted().close).toBeUndefined()
    const first = execute.mock.calls[0]![0]
    execute.mockRejectedValueOnce(credentialProblem('forbidden', '暂时没有权限'))
    await fireEvent.click(screen.getByRole('button', { name: '恢复原提交' }))
    await screen.findByText('暂时没有权限')
    expect(screen.getByRole('button', { name: '恢复原提交' })).toBeTruthy()
    read.mockRejectedValueOnce(credentialProblem('forbidden', '当前读取也无权'))
    await expect(session.load()).rejects.toThrow(/读取也无权/)
    const reload = await screen.findByRole('button', { name: '重新核对当前资料' })
    expect((reload as HTMLButtonElement).disabled).toBe(false)
    await fireEvent.click(reload)
    await screen.findByLabelText('公司名称手工确认值')
    await fireEvent.click(await screen.findByRole('button', { name: '恢复原提交' }))
    await waitFor(() => expect(emitted().close).toHaveLength(1))
    expect(execute.mock.calls[2]![0]).toEqual(first)
  })

  it('版本冲突保留人工草稿，重新核对同一识别后的当前主档与基准', async () => {
    await setup()
    await enterManualName()
    execute.mockRejectedValueOnce(credentialProblem('conflict', '资料已变化'))
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    await screen.findByRole('button', { name: '重新核对当前资料' })
    read.mockResolvedValue(snapshot({ supplierVersion: 'new-s', credentialVersion: 'new-c', masterValues: { name: '最新当前公司' } }))
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前资料' }))
    await screen.findByText('最新当前公司')
    expect((screen.getByLabelText('公司名称手工确认值') as HTMLInputElement).value).toBe('人工输入保留')
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute.mock.calls[1]![0]).toMatchObject({ baseSupplierVersion: 'new-s', baseCredentialVersion: 'new-c', draft: { choices: expect.arrayContaining([{ key: 'name', decision: 'manual', manualValue: '人工输入保留' }]) } })
  })

  it('新识别结果要求明确切换，旧人工选择不静默套用', async () => {
    const { session } = await setup()
    await enterManualName()
    read.mockResolvedValue(snapshot({ credentials: [credentialRecord({ recognition: recognition('new-recognition', '第二份 OCR 公司') })], supplierVersion: 'new-s', credentialVersion: 'new-c' }))
    await session.recheck()
    await screen.findByRole('button', { name: '核对新识别结果' })
    expect(screen.queryByText('第二份 OCR 公司')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '核对新识别结果' }))
    expect((screen.getByLabelText('公司名称手工确认值') as HTMLInputElement).value).toBe('人工输入保留')
    confirm.mockResolvedValueOnce(true)
    await fireEvent.click(screen.getByRole('button', { name: '核对新识别结果' }))
    await screen.findByText('第二份 OCR 公司')
    expect(screen.queryByLabelText('公司名称手工确认值')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(execute.mock.calls[0]![0]).toMatchObject({ draft: { recognitionId: 'new-recognition', choices: expect.arrayContaining([{ key: 'name', decision: 'keep-current' }]) } })
  })

  it('切换页签隐藏浮层，返回恢复人工草稿且不询问放弃', async () => {
    const { rerender } = await setup()
    await enterManualName()
    await rerender({ active: false })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(confirm).not.toHaveBeenCalled()
    await rerender({ active: true })
    await screen.findByLabelText('公司名称手工确认值')
    expect((screen.getByLabelText('公司名称手工确认值') as HTMLInputElement).value).toBe('人工输入保留')
  })

  it('设置读取期间切换目标不发送迟到识别，A 的手工草稿不串入 B', async () => {
    let finishSettings!: () => void
    settings.load.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishSettings = resolve
    }))
    const { target, session } = await setup(snapshot(), true)
    await waitFor(() => expect(settings.load).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '关闭', exact: true }).getAttribute('aria-disabled')).toBe('true')
    target.supplierId = 'supplier-b'
    read.mockResolvedValue(snapshot({ supplierId: 'supplier-b', masterValues: { name: 'B 当前公司' }, credentials: [credentialRecord({ supplierId: 'supplier-b', recognition: recognition('b', 'B OCR 公司') })] }))
    await session.load()
    finishSettings()
    await screen.findByText('B 当前公司')
    expect(screen.queryByText('当前公司')).toBeNull()
    expect(execute).not.toHaveBeenCalled()
  })

  it('无主档写权只留历史线索；缺原件不能重新识别', async () => {
    await setup(snapshot({ capabilities: ['supplier-credential:read'], masterValues: undefined, credentials: [credentialRecord({ file: null, recognition: null, ocrResult: { fields: [{ key: 'uniqueCode', value: '旧编码' }] }, ocrConfirmedResult: { fields: { uniqueCode: '历史人工编码' } }, ocrConfirmedAt: '2024-01-01T00:00:00Z' })] }))
    expect(screen.queryByRole('button', { name: '保存核对结果' })).toBeNull()
    expect(screen.getByText('历史识别与人工确认记录')).toBeTruthy()
    await fireEvent.click(screen.getByText('历史识别与人工确认记录'))
    expect(screen.getByText('上次人工确认')).toBeTruthy()
    expect(screen.getByText('内部唯一识别码：历史人工编码')).toBeTruthy()
    expect(screen.getByText('原始记录')).toBeTruthy()
    expect((screen.getByRole('button', { name: '重新识别原件' }) as HTMLButtonElement).disabled).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })
})
