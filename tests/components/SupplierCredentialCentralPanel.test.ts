import type { SupplierCredentialCommand, SupplierCredentialRepository } from '~/lib/supplier/credential-contract'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, useRoute } from 'vue-router'
import SupplierCredentialCentralPanel from '~/components/supplier/SupplierCredentialCentralPanel.vue'
import { credentialProblem } from '~/lib/supplier/credential-contract'
import { useTabsStore } from '~/stores/tabs'
import { credentialRecord, credentialSnapshot } from '../supplier/credential-ui-fixtures'

const read = vi.fn<SupplierCredentialRepository['read']>()
const execute = vi.fn<SupplierCredentialRepository['execute']>()
const file = vi.fn<SupplierCredentialRepository['file']>()
const confirm = vi.fn()
const notice = vi.fn()
const recognition = vi.hoisted(() => vi.fn())
vi.mock('~/lib/recognize/engine', () => ({ recognizeDocument: recognition }))

async function setup(options: { origin?: 'real' | 'demo', returnTo?: string } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const origin = options.origin ?? 'real'
  const route = `/base/supplier/credential/supplier-a?origin=${origin}${options.returnTo ? `&returnTo=${encodeURIComponent(options.returnTo)}` : ''}`
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: '/base/supplier/credential/:id', component: SupplierCredentialCentralPanel, props: route => ({ supplierId: String(route.params.id), origin: route.query.origin ?? 'real', returnTo: route.query.returnTo }) },
    { path: '/other', component: { template: '<h1>其他页签</h1>' } },
  ] })
  vi.stubGlobal('useRoute', useRoute)
  vi.stubGlobal('useTabsStore', useTabsStore)
  vi.stubGlobal('useDataVisibilityStore', () => ({ includeDemo: true }))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { supplierCredentials: { read, execute, file } } }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => ({ confirm, success: notice, warning: notice }))
  await router.push(route)
  await router.isReady()
  const tabs = useTabsStore()
  tabs.open({ fullPath: route, title: '合成证照' })
  const view = render(defineComponent({ template: '<RouterView v-slot="{ Component }"><KeepAlive><component :is="Component" :key="$route.path" /></KeepAlive></RouterView>' }), { global: {
    plugins: [pinia, router],
    stubs: { NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } },
  } })
  await screen.findByText('证照原件 · 0 份').catch(() => undefined)
  return { ...view, router, tabs, route }
}

beforeEach(() => {
  read.mockReset().mockResolvedValue(credentialSnapshot())
  execute.mockReset().mockImplementation(async (command: SupplierCredentialCommand) => ({ commandId: command.commandId, supplierId: command.supplierId, credentialId: 'credential-a', auditId: 'audit-a', deletionToken: null, supplierVersion: 's2', credentialVersion: 'c2' }))
  file.mockReset()
  confirm.mockReset().mockResolvedValue(false)
  notice.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('中央证照人工工作面', () => {
  it('当前资格失效仍展示人工历史；逐件使用服务器业务日状态，坏日期显示待核对', async () => {
    const proof = { decision: 'qualified' as const, reviewedAt: '2026-09-10T00:00:00Z', actorId: '历史核验人', note: '核验时所见原件已保全' }
    read.mockResolvedValue(credentialSnapshot({ status: 'incomplete', review: proof, reviewCurrent: false, reviewHistory: [proof], credentials: [credentialRecord({ expiresAt: '2026-02-30', validity: { businessDate: '2026-09-12', state: 'unrecorded', reason: 'invalid-date' } })] }))
    await setup()
    await screen.findByText('核验时所见原件已保全', { exact: false })
    expect(screen.getByText('历史凭证已保留；当前资料或有效期已变化，不能据此认定当前资料已核验。')).toBeTruthy()
    expect(screen.getByText('日期无效 · 待核对')).toBeTruthy()
    expect((screen.getByRole('button', { name: '人工核验通过' }) as HTMLButtonElement).disabled).toBe(true)
    expect(execute).not.toHaveBeenCalled()
  })

  it('pDF 预览先聚焦关闭按钮，退出后恢复原预览按钮', async () => {
    const record = credentialRecord()
    read.mockResolvedValue(credentialSnapshot({ credentials: [record] }))
    file.mockResolvedValue({ ...record.file!, state: 'available', fileId: 'file-a', supplierId: 'supplier-a', credentialId: 'credential-a', origin: 'real', payloadBase64: btoa('%PDF-1.7 synthetic'), sha256: 'a'.repeat(64) })
    await setup()
    const trigger = screen.getByRole('button', { name: '预览 合成营业执照.pdf' })
    trigger.focus()
    await fireEvent.click(trigger)
    const preview = await screen.findByRole('dialog', { name: '合成营业执照.pdf' })
    const close = within(preview).getByRole('button', { name: '关闭', exact: true })
    await waitFor(() => expect(document.activeElement).toBe(close))
    await fireEvent.click(close)
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '合成营业执照.pdf' })).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('独立上传真实原件；失败保留文件，用同一 commandId 恢复，不触发 OCR', async () => {
    await setup()
    await fireEvent.click(screen.getByRole('button', { name: '上传原件' }))
    const input = screen.getByLabelText('选择原件')
    await fireEvent.change(input, { target: { files: [new File(['%PDF-1.7 synthetic'], '合成原件.pdf', { type: 'application/pdf' })] } })
    await fireEvent.change(screen.getByLabelText('证照类别'), { target: { value: '法人身份证' } })
    execute.mockRejectedValueOnce(credentialProblem('unavailable', '响应丢失，请恢复原提交'))
    await fireEvent.click(screen.getByRole('button', { name: '保存原件' }))
    await screen.findByRole('button', { name: '恢复原提交' })
    expect(screen.getByText('已选：合成原件.pdf')).toBeTruthy()
    expect(screen.getByLabelText('证照类别').closest('fieldset')?.disabled).toBe(true)
    const original = execute.mock.calls[0]![0]
    expect(original).toMatchObject({ action: 'upload', draft: { fileName: '合成原件.pdf', category: '法人身份证', payloadBase64: btoa('%PDF-1.7 synthetic') } })
    await fireEvent.click(screen.getByRole('button', { name: '恢复原提交' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '上传证照原件' })).toBeNull())
    expect(execute.mock.calls[1]![0]).toEqual(original)
    expect(recognition).not.toHaveBeenCalled()
  })

  it('版本冲突保留核验备注，重新核对后明确提交新基准', async () => {
    read.mockResolvedValue(credentialSnapshot({ status: 'reviewing' }))
    await setup()
    await fireEvent.click(screen.getByRole('button', { name: '人工核验通过' }))
    await fireEvent.update(screen.getByLabelText('核验备注（选填）'), '核对原件后通过')
    execute.mockRejectedValueOnce(credentialProblem('conflict', '资料已变化'))
    await fireEvent.click(screen.getByRole('button', { name: '确认通过' }))
    await screen.findByRole('button', { name: '重新核对当前资料' })
    expect((screen.getByRole('button', { name: '确认通过' }) as HTMLButtonElement).disabled).toBe(true)
    read.mockResolvedValue(credentialSnapshot({ status: 'reviewing', supplierVersion: 's-new', credentialVersion: 'c-new' }))
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前资料' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '确认通过' }) as HTMLButtonElement).disabled).toBe(false))
    expect((screen.getByLabelText('核验备注（选填）') as HTMLTextAreaElement).value).toBe('核对原件后通过')
    await fireEvent.click(screen.getByRole('button', { name: '确认通过' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute.mock.calls[1]![0]).toMatchObject({ baseSupplierVersion: 's-new', baseCredentialVersion: 'c-new' })
  })

  it('切换已有页签保留文件草稿；请求关闭页签才询问，取消继续保留', async () => {
    const { router, tabs } = await setup()
    await fireEvent.click(screen.getByRole('button', { name: '上传原件' }))
    await fireEvent.change(screen.getByLabelText('选择原件'), { target: { files: [new File(['%PDF-1.7 synthetic'], '保留草稿.pdf', { type: 'application/pdf' })] } })
    await router.push('/other')
    await screen.findByRole('heading', { name: '其他页签' })
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '上传证照原件' })).toBeNull()
    await router.push('/base/supplier/credential/supplier-a?origin=real')
    await screen.findByText('已选：保留草稿.pdf')
    expect(await tabs.requestClose('/base/supplier/credential/supplier-a')).toBe(false)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(screen.getByText('已选：保留草稿.pdf')).toBeTruthy()
  })

  it('表单来源改变前确认，拒绝后保留当前身份和输入', async () => {
    const { router } = await setup()
    await fireEvent.click(screen.getByRole('button', { name: '上传原件' }))
    await fireEvent.change(screen.getByLabelText('证照类别'), { target: { value: '资质证书' } })
    await router.push('/base/supplier/credential/supplier-a?origin=demo')
    expect(router.currentRoute.value.query.origin).toBe('real')
    expect((screen.getByLabelText('证照类别') as HTMLSelectElement).value).toBe('资质证书')
    expect(confirm).toHaveBeenCalledTimes(1)
  })

  it('a→B→A 是独立身份页签，A 的草稿不会带给 B，也不会在往返时丢失', async () => {
    read.mockImplementation(async (supplierId, origin) => credentialSnapshot({ supplierId, dataOrigin: origin, supplierName: supplierId === 'supplier-a' ? '合成分供方 A' : '合成分供方 B' }))
    const { router, tabs } = await setup()
    tabs.open({ fullPath: '/base/supplier/credential/supplier-b?origin=real', title: 'B 证照' })
    await fireEvent.click(screen.getByRole('button', { name: '上传原件' }))
    await fireEvent.change(screen.getByLabelText('选择原件'), { target: { files: [new File(['%PDF-1.7 synthetic'], '只属于 A.pdf', { type: 'application/pdf' })] } })
    await router.push('/base/supplier/credential/supplier-b?origin=real')
    await screen.findByRole('heading', { name: '合成分供方 B · 证照附件' })
    expect(screen.queryByText('已选：只属于 A.pdf')).toBeNull()
    expect(confirm).not.toHaveBeenCalled()
    await router.push('/base/supplier/credential/supplier-a?origin=real')
    await screen.findByText('已选：只属于 A.pdf')
    expect(execute).not.toHaveBeenCalled()
  })

  it('列表直接进入证照页，返回同来源详情并保留列表位置', async () => {
    const returnTo = '/base/supplier/supplier-a?origin=real&returnTo=%2Fbase%2Fsupplier%3Fpage%3D2%23supplier-row-real%253Asupplier-a'
    await setup({ returnTo })
    const link = screen.getByRole('link', { name: '返回分供方详情' })
    const target = new URL(link.getAttribute('href')!, 'https://example.test')
    expect(target.pathname).toBe('/base/supplier/supplier-a')
    expect(target.searchParams.get('origin')).toBe('real')
    expect(target.searchParams.get('returnTo')).toContain('page=2')
    expect(target.searchParams.get('returnTo')).toContain('supplier-a')
  })

  it('无正文证照清楚显示缺失，既不预览旧路径也不伪装有原件', async () => {
    read.mockResolvedValue(credentialSnapshot({ credentials: [credentialRecord({ file: null, legacyFilePath: 'D:\\不可读取的旧原件.pdf' })] }))
    await setup()
    expect(screen.getByText('历史原件 · 缺少正文，请重新上传')).toBeTruthy()
    expect((screen.getByRole('button', { name: '预览 营业执照' }) as HTMLButtonElement).disabled).toBe(true)
    expect(file).not.toHaveBeenCalled()
  })

  it('类别有效期和条件资料要求分别生成各自的人工命令', async () => {
    read.mockResolvedValue(credentialSnapshot({ credentials: [credentialRecord()] }))
    await setup()
    await fireEvent.click(screen.getByRole('button', { name: '编辑类别和有效期 合成营业执照.pdf' }))
    await fireEvent.change(screen.getByLabelText('证照类别'), { target: { value: '银行账户资料' } })
    await fireEvent.click(screen.getByLabelText('长期有效'))
    await fireEvent.click(screen.getByRole('button', { name: '保存资料' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑类别和有效期' })).toBeNull())
    expect(execute.mock.calls[0]![0]).toMatchObject({ action: 'edit', credentialId: 'credential-a', draft: { category: '银行账户资料', validFrom: '', expiresAt: '', longTerm: true } })
    await fireEvent.click(screen.getByRole('button', { name: '维护资质证书要求' }))
    await fireEvent.change(screen.getByLabelText('要求状态'), { target: { value: 'required' } })
    await fireEvent.update(screen.getByLabelText('要求原因'), '本次专业工程要求')
    await fireEvent.click(screen.getByRole('button', { name: '保存要求' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute.mock.calls[1]![0]).toMatchObject({ action: 'requirement', draft: { category: '资质证书', requirement: 'required', reason: '本次专业工程要求' } })
  })

  it('删除后的撤回携带当前审计身份及本次删除 token', async () => {
    read.mockResolvedValue(credentialSnapshot({ credentials: [credentialRecord()] }))
    await setup()
    await fireEvent.click(screen.getByRole('button', { name: '删除 合成营业执照.pdf' }))
    const audit = { id: 'delete-audit', credentialId: 'credential-a', action: 'delete', categoryBefore: '营业执照', categoryAfter: '', changedFields: [], validFromBefore: '', validFromAfter: '', expiresAtBefore: '', expiresAtAfter: '', longTermBefore: null, longTermAfter: null, confidence: null, createdAt: '2026-09-12T01:00:00Z', actorId: 'actor-a', deletionToken: 'only-current-deletion', canRestore: true }
    read.mockResolvedValue(credentialSnapshot({ audits: [audit], credentialVersion: 'c-delete' }))
    await fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByRole('button', { name: '撤回本次删除' })
    expect(execute.mock.calls[0]![0]).toMatchObject({ action: 'delete', credentialId: 'credential-a' })
    await fireEvent.click(screen.getByRole('button', { name: '撤回本次删除' }))
    await fireEvent.click(screen.getByRole('button', { name: '确认撤回' }))
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(execute.mock.calls[1]![0]).toMatchObject({ action: 'restore', credentialId: 'credential-a', auditId: 'delete-audit', deletionToken: 'only-current-deletion', baseCredentialVersion: 'c-delete' })
  })
})
