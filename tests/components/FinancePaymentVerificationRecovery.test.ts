import type { ExpenseClearanceProof, ExpenseClearanceVerificationState } from '~/lib/finance/clearance-verification'
import type { PaymentVerificationProof, PaymentVerificationState } from '~/lib/finance/payment-verification'
import { createHash, webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import FinanceFormPage from '~/components/finance/FinanceFormPage.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import KitButton from '~/components/ui/KitButton.vue'
import { useFinanceFormAttachments } from '~/composables/useFinanceFormAttachments'
import { f3FormDefaults } from '~/lib/finance/page'
import { useProductionAccessStore } from '~/stores/production-access'

vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
vi.mock('vue-router', () => ({ onBeforeRouteLeave: vi.fn(), onBeforeRouteUpdate: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
const route = { params: { id: 'pay08-current-application' }, query: {}, fullPath: '/finance/payment/pay08-current-application' }
const bytes = new Uint8Array([0, 10, 128, 255])
const sha = createHash('sha256').update(bytes).digest('hex')
const file = { id: 'pay08-saved-original', ownerType: 'payment_application', ownerId: route.params.id, fileName: '实际依据.bin', filePath: '', fileSize: 4, mimeType: 'application/octet-stream', category: '业务附件', uploader: '原上传人', uploadedAt: '2026-10-05T00:00:00.000Z', deletedAt: null, sha256: sha }
const proof: PaymentVerificationProof = { schemaVersion: 'payment-verification-v1', applicationId: route.params.id, applicationVersion: '2', commandId: 'pay08-saved-command', workspaceId: 'pay08-workspace', actorId: 'pay08-owner', verifiedAt: '2026-10-05T01:00:00.000Z', applicationSnapshotSha256: 'a'.repeat(64), actualDueAmount: 70, cumulativePayableAmount: 70, basis: '原已确认结算70和原已付20逐条核验', fileIds: [file.id], sources: [{ owner: 'other-settlements', id: 'pay08-actual-settlement', version: '1', sourceVersion: 'other-settlement-record-1', fingerprint: 'b'.repeat(64), evidenceJson: JSON.stringify({ id: 'pay08-actual-settlement', version: '1', ownerSnapshotSha256: 'c'.repeat(64) }) }], originals: [{ id: file.id, ownerType: file.ownerType, ownerId: file.ownerId, fileName: file.fileName, fileSize: 4, sha256: sha }] }
const state = (verified = false): PaymentVerificationState => verified ? { required: true, status: 'verified', message: '已冻结当前核验', proof: structuredClone(proof) } : { required: true, status: 'missing', message: '请核验历史未知批复', proof: null }
const record = (verified = false) => ({ ...f3FormDefaults('payment_application'), id: route.params.id, name: '历史付款申请', note: '原历史说明', bizType: '公司付款', supplierId: 'pay08-actual-supplier', applyAmount: 70, approvedAmount: 0, approvedAmountOrigin: 'legacy', paymentVerification: state(verified) })
const context = { workspaceId: 'pay08-workspace', actorId: 'pay08-owner', capabilities: ['finance-payment-application:read', 'finance-payment-application:write'] }
const feedback = { confirm: vi.fn(async () => false), success: vi.fn(), warning: vi.fn(), error: vi.fn() }
const store = {
  isCentral: () => true,
  createFormSession: vi.fn(),
  hydrateForm: vi.fn(),
  revalidateForm: vi.fn(),
  invalidateForm: vi.fn(),
  recoverForm: vi.fn(),
  formAttachments: vi.fn(),
  originalContent: vi.fn(),
  saveForm: vi.fn(),
  loadOne: vi.fn(),
  searchProjects: vi.fn(),
  searchCustomers: vi.fn(),
  searchSuppliers: vi.fn(),
  searchWorkers: vi.fn(),
}
const shell = Vue.defineComponent({ template: '<main><slot/></main>' })
const fields = Vue.defineComponent({ props: ['draft'], emits: ['patch'], template: '<label>备注<input aria-label="后来付款说明" :value="draft.note" @input="$emit(\'patch\', { note: $event.target.value })"></label>' })
const fileSection = Vue.defineComponent({ emits: ['files'], template: '<section>原件区<input aria-label="上传真实替代文件" type="file" @change="$emit(\'files\', Array.from($event.target.files ?? []))"></section>' })
function open(kind: 'payment_application' | 'reimbursement' = 'payment_application') {
  return render(FinanceFormPage, { props: { kind }, global: { components: { EntityFormShell: shell, FinanceFormFields: fields, FileRefAttachmentSection: fileSection, FormFooter, KitButton } } })
}
async function fill() {
  await fireEvent.update(screen.getByRole('textbox', { name: '核实累计应付金额' }), '70')
  await fireEvent.update(screen.getByRole('textbox', { name: '核实累计可付金额' }), '70')
  await fireEvent.update(screen.getByRole('textbox', { name: '业务核验依据' }), proof.basis)
  await fireEvent.click(screen.getByRole('checkbox', { name: '核验依据 实际依据.bin' }))
}
beforeEach(async () => {
  route.params.id = 'pay08-current-application'
  route.fullPath = '/finance/payment/pay08-current-application'
  setActivePinia(createPinia())
  vi.clearAllMocks()
  for (const name of ['computed', 'ref', 'shallowRef', 'toRef', 'watch', 'nextTick', 'onMounted', 'onActivated', 'onDeactivated', 'onBeforeUnmount'] as const) vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useFinanceStore', () => store)
  vi.stubGlobal('useFinanceFormAttachments', useFinanceFormAttachments)
  vi.stubGlobal('useTabsStore', () => ({ close: vi.fn() }))
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useKitUI', () => feedback)
  vi.stubGlobal('navigateTo', vi.fn(async () => undefined))
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionAccess: { status: async () => ({ mode: 'production', authenticated: true, ownerId: 'pay08-owner', purpose: 'verification' }), logout: async () => undefined } } }))
  await useProductionAccessStore().check()
  store.createFormSession.mockImplementation(() => Vue.shallowReactive({ context, authority: context, targetId: route.params.id, baseVersion: '1', pending: null, generation: 0, busy: false }))
  store.hydrateForm.mockImplementation(async () => ({ form: { draft: record(), attachments: [file] }, context }))
  store.revalidateForm.mockImplementation(async () => ({ form: { draft: record(true), attachments: [file] }, context }))
  store.loadOne.mockResolvedValue(record(true))
  store.formAttachments.mockResolvedValue([file])
  store.originalContent.mockResolvedValue({ bytes, mimeType: 'application/octet-stream' })
  store.invalidateForm.mockImplementation((_kind, session) => {
    session.context = null
    session.generation++
  })
  store.recoverForm.mockImplementation(async (_kind, session) => {
    session.pending = null
    return { outcome: 'applied', result: { id: route.params.id, attachmentIds: [], commandId: proof.commandId }, form: { draft: record(true), attachments: [file] }, context }
  })
})

const expenseHead = 'actual-original-expense-head'
const expenseFile = { ...file, id: 'actual-expense-original', ownerType: 'expense_reimbursement', ownerId: expenseHead, fileName: '原账签收与银行范围.bin' }
const expenseProof: ExpenseClearanceProof = { schemaVersion: 'expense-clearance-verification-v1', id: 'actual-expense-verification', originalExpenseLineId: 'actual-original-expense-line', headerId: expenseHead, expenseVersion: '2', sourceHash: 'd'.repeat(64), workspaceId: context.workspaceId, actorId: context.actorId, verifiedAt: '2026-10-05T01:00:00.000Z', commandId: 'original-expense-command', basis: '原账及银行完整范围交叉核实旧30尚未付款', items: [{ id: 'actual-recognition-item', sourceClearanceLineId: 'actual-old-clearance-line', amount: 30, matchBasis: '旧原账行明确属于原费用，未付30义务不消失', missingOriginalDocument: true }], originals: [{ id: expenseFile.id, ownerType: expenseFile.ownerType, ownerId: expenseHead, fileName: expenseFile.fileName, fileSize: 4, sha256: sha }], sourceSnapshot: {} }
function expenseState(verified = false): ExpenseClearanceVerificationState {
  const sources = [{ id: expenseProof.originalExpenseLineId, headerId: expenseHead, projectId: null, amount: 100, version: verified ? '2' : '1', sourceRevision: 'finance-10', clearedAmount: 30, expenseItem: '原实际费用', serviceSupplierId: 'actual-service-supplier', serviceSupplierNameSnapshot: '实际服务方', applicantWorkerId: null, applicantSupplierId: 'actual-payee-supplier', applicantNameSnapshot: '原实际垫付人', clearances: [{ id: 'actual-old-clearance-line', headerId: 'actual-old-clearance-head', originalExpenseLineId: expenseProof.originalExpenseLineId, amount: 30, status: 'confirmed', deletedAt: null, headerDeletedAt: null, sourceVersion: '1', missingOriginalDocument: true, originalDocumentState: 'missing-body' as const }], clearanceSourceHash: expenseProof.sourceHash, clearanceProofs: verified ? [expenseProof] : [], clearanceLinks: [], clearanceItemAvailability: verified ? [{ verificationId: expenseProof.id, itemId: 'actual-recognition-item', amountRemaining: 30 }] : [], qualification: { state: verified ? 'verified' as const : 'missing' as const, message: '原单缺失，替代证据不制造银行实付', verificationId: verified ? expenseProof.id : null, recordedHandledAmount: 30, verifiedHandledAmount: verified ? 30 : null, confirmedOtherAdoptedAmount: 0, verifiedOverlapAmount: verified ? 0 : null, newAdoptableAmount: verified ? 70 : null, legacyObligationAmount: 30, legacyPaidAmount: verified ? 0 : null, legacyUnpaidAmount: verified ? 30 : null } }]
  return { status: verified ? 'verified' : 'missing', message: '保全原费用100、旧处理30与原单缺失', sources, proofs: verified ? [expenseProof] : [] }
}
const expenseRecord = (verified = false) => ({ ...f3FormDefaults('reimbursement'), id: expenseHead, status: 'confirmed', note: '原费用说明', totalAmount: 100, lines: [{ id: expenseProof.originalExpenseLineId, expenseItem: '原实际费用', amount: 100 }], clearanceVerification: expenseState(verified) })
function expenseOwner(verified = false) {
  route.params.id = expenseHead
  route.fullPath = `/finance/reimbursement/${expenseHead}`
  store.hydrateForm.mockResolvedValue({ form: { draft: expenseRecord(verified), attachments: [expenseFile] }, context })
  store.revalidateForm.mockResolvedValue({ form: { draft: expenseRecord(true), attachments: [expenseFile] }, context })
  store.loadOne.mockResolvedValue(expenseRecord(true))
  store.formAttachments.mockResolvedValue([expenseFile])
  store.recoverForm.mockImplementation(async (_kind, session) => {
    session.pending = null
    return { outcome: 'applied', result: { id: expenseHead, commandId: expenseProof.commandId, attachmentIds: [] }, form: { draft: expenseRecord(true), attachments: [expenseFile] }, context }
  })
}
async function fillClearance() {
  await fireEvent.update(screen.getByRole('combobox', { name: '选择原费用行' }), expenseProof.originalExpenseLineId)
  await fireEvent.click(screen.getByRole('button', { name: '新增核定份额' }))
  await fireEvent.update(screen.getByRole('combobox', { name: '第 1 项份额来源' }), 'actual-old-clearance-line')
  await fireEvent.update(screen.getByRole('textbox', { name: '第 1 项核定处理金额' }), '30')
  await fireEvent.update(screen.getByRole('textbox', { name: '第 1 项原费用匹配依据' }), expenseProof.items[0]!.matchBasis)
  await fireEvent.update(screen.getByRole('textbox', { name: '替代核验说明' }), expenseProof.basis)
  await fireEvent.click(screen.getByRole('checkbox', { name: `替代证据 ${expenseFile.fileName}` }))
}

it('旧费用核验按严格原save提交，已知后读失败只读恢复并保后来核验输入和新冻结事实', async () => {
  expenseOwner()
  let finish!: (value: unknown) => void
  store.saveForm.mockImplementationOnce((_kind, _draft, _action, _attachments, session) => {
    session.pending = { id: expenseProof.commandId, result: { id: expenseHead, commandId: expenseProof.commandId } }
    return new Promise(resolve => finish = resolve)
  })
  open('reimbursement')
  await flushPromises()
  await fillClearance()
  expect(screen.getByRole('button', { name: '保存草稿' }).hasAttribute('disabled')).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '保存旧清偿替代核验' }))
  expect(store.saveForm.mock.calls[0]!.slice(0, 4)).toEqual(['reimbursement', { id: expenseHead, clearanceVerificationEdit: { originalExpenseLineId: expenseProof.originalExpenseLineId, sourceVersion: '1', sourceHash: expenseProof.sourceHash, basis: expenseProof.basis, fileIds: [expenseFile.id], items: [{ sourceClearanceLineId: 'actual-old-clearance-line', amount: 30, matchBasis: expenseProof.items[0]!.matchBasis }], existingBindings: [] } }, 'save', {}])
  await fireEvent.update(screen.getByRole('textbox', { name: '后来付款说明' }), '保存途中后来补写的私有说明')
  finish({ id: expenseHead, logId: 'actual-expense-log', attachmentIds: [], readbackConfirmed: false, readbackProblem: '已保存核定，GET失败' })
  await flushPromises()
  await fireEvent.click(screen.getByRole('button', { name: '只重试读取' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: '财务记录已保存待刷新' })).toBeNull())
  expect(store.saveForm).toHaveBeenCalledTimes(1)
  expect(store.recoverForm).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('textbox', { name: '后来付款说明' }) as HTMLInputElement).value).toBe('保存途中后来补写的私有说明')
  expect(screen.getByText(context.actorId)).toBeTruthy()
  expect(screen.getByText('旧份额待实付').parentElement!.textContent).toContain('30.00')
  expect(navigateTo).not.toHaveBeenCalled()
})

it('替代核验结果未知保原提交，恢复采用原receipt且不重发核定或把旧30变现金', async () => {
  expenseOwner()
  store.saveForm.mockImplementationOnce(async (_kind, _draft, _action, _attachments, session) => {
    session.pending = { id: expenseProof.commandId, result: null }
    throw new Error('原核定提交结果未知')
  })
  open('reimbursement')
  await flushPromises()
  await fillClearance()
  await fireEvent.click(screen.getByRole('button', { name: '保存旧清偿替代核验' }))
  await flushPromises()
  expect(screen.getByRole('button', { name: '保存旧清偿替代核验' }).hasAttribute('disabled')).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '核对原提交' }))
  await waitFor(() => expect(screen.getByText(context.actorId)).toBeTruthy())
  expect(store.saveForm).toHaveBeenCalledTimes(1)
  expect(store.recoverForm).toHaveBeenCalledTimes(1)
  expect(screen.getByText('已保留原单缺失记录；此核验不会补造遗失原件或银行实付。')).toBeTruthy()
})

it('费用来源撤权同步隐藏旧核定事实，恢复只读保私有替代依据不沿旧事实再次保存', async () => {
  expenseOwner(true)
  open('reimbursement')
  await flushPromises()
  await fillClearance()
  await fireEvent.update(screen.getByRole('textbox', { name: '替代核验说明' }), '尚未提交的新替代说明')
  await useProductionAccessStore().logout()
  await flushPromises()
  expect(screen.queryByRole('region', { name: '旧清偿替代核验' })).toBeNull()
  expect(screen.queryByText(context.actorId)).toBeNull()
  await useProductionAccessStore().check()
  await fireEvent.click(screen.getByRole('button', { name: '重试读取来源' }))
  await waitFor(() => expect(screen.getByRole('region', { name: '旧清偿替代核验' })).toBeTruthy())
  expect((screen.getByRole('textbox', { name: '替代核验说明' }) as HTMLTextAreaElement).value).toBe('尚未提交的新替代说明')
  expect(store.saveForm).not.toHaveBeenCalled()
})

it('已确认费用仅追加真实替代原件，严格add意图不混未保存正文，读回保原说明输入', async () => {
  expenseOwner()
  open('reimbursement')
  await flushPromises()
  await fireEvent.update(screen.getByRole('textbox', { name: '后来付款说明' }), '未保存的费用说明')
  await fireEvent.change(screen.getByLabelText('上传真实替代文件'), { target: { files: [new File([bytes], '新增替代原件.bin', { type: 'application/octet-stream' })] } })
  const save = screen.getByRole('button', { name: '保存新增替代原件' })
  await waitFor(() => expect(save.hasAttribute('disabled')).toBe(false))
  store.saveForm.mockImplementationOnce(async (_kind, _draft, _action, changes) => {
    const saved = { ...changes.add[0], id: 'saved-new-replacement', ownerType: 'expense_reimbursement', ownerId: expenseHead, deletedAt: null }
    store.formAttachments.mockResolvedValue([expenseFile, saved])
    return { id: expenseHead, logId: 'original-addition-log', attachmentIds: [saved.id], readbackConfirmed: true }
  })
  await fireEvent.click(save)
  await waitFor(() => expect(store.saveForm).toHaveBeenCalledTimes(1))
  await flushPromises()
  expect(store.saveForm.mock.calls[0]!.slice(0, 3)).toEqual(['reimbursement', { id: expenseHead, clearanceAttachmentsOnly: true }, 'save'])
  expect(Object.keys(store.saveForm.mock.calls[0]![3])).toEqual(['add'])
  expect((screen.getByRole('textbox', { name: '后来付款说明' }) as HTMLInputElement).value).toBe('未保存的费用说明')
  expect(navigateTo).not.toHaveBeenCalled()
})

it('核验空输入不冒充0；申请普通编辑未存时核验不可用且不改历史原字段', async () => {
  open()
  await flushPromises()
  await fireEvent.click(screen.getByRole('button', { name: '保存业务核验' }))
  expect(feedback.warning).toHaveBeenCalledWith('请明确填写两项非负累计金额，未知或空值不能作为零。')
  expect(store.saveForm).not.toHaveBeenCalled()
  await fill()
  expect(screen.getByRole('button', { name: '保存草稿' }).hasAttribute('disabled')).toBe(true)
  expect(screen.getByRole('button', { name: '保存业务核验' }).hasAttribute('disabled')).toBe(false)
  await fireEvent.update(screen.getByRole('textbox', { name: '后来付款说明' }), '尚未保存的普通编辑')
  expect(screen.getByRole('button', { name: '保存业务核验' }).hasAttribute('disabled')).toBe(true)
  expect(store.saveForm).not.toHaveBeenCalled()
})

it('核验已保存后读取失败只读恢复，后来普通输入和新冻结核验同时保留，不重发、不离页', async () => {
  let finish!: (value: unknown) => void
  store.saveForm.mockImplementationOnce((_kind, _draft, _action, _attachments, session) => {
    session.pending = { id: proof.commandId, result: { id: route.params.id, commandId: proof.commandId } }
    return new Promise(resolve => finish = resolve)
  })
  open()
  await flushPromises()
  await fill()
  await fireEvent.click(screen.getByRole('button', { name: '保存业务核验' }))
  expect(store.saveForm.mock.calls[0]![1]).toEqual({ id: route.params.id, verificationEdit: { actualDueAmount: 70, cumulativePayableAmount: 70, basis: proof.basis, fileIds: [file.id] } })
  await fireEvent.update(screen.getByRole('textbox', { name: '后来付款说明' }), '保存期间后来补写的说明')
  finish({ id: route.params.id, logId: 'pay08-log', attachmentIds: [], readbackConfirmed: false, readbackProblem: '核验已保存但GET失败' })
  await flushPromises()
  expect(screen.getByRole('region', { name: '财务记录已保存待刷新' }).textContent).toContain('核验已保存但GET失败')
  expect(screen.getByRole('button', { name: '保存业务核验' }).hasAttribute('disabled')).toBe(true)
  await fireEvent.click(screen.getByRole('button', { name: '只重试读取' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: '财务记录已保存待刷新' })).toBeNull())
  expect(store.saveForm).toHaveBeenCalledTimes(1)
  expect(store.recoverForm).toHaveBeenCalledTimes(1)
  expect((screen.getByRole('textbox', { name: '后来付款说明' }) as HTMLInputElement).value).toBe('保存期间后来补写的说明')
  expect(screen.getByText('核验人')).toBeTruthy()
  expect(screen.getByText('pay08-owner')).toBeTruthy()
  expect((screen.getByRole('textbox', { name: '业务核验依据' }) as HTMLTextAreaElement).value).toBe('')
  expect(navigateTo).not.toHaveBeenCalled()
})

it('真实权限撤回同步隐藏已冻结事实，重新授权读取保私有核验输入而不沿旧事实保存', async () => {
  store.hydrateForm.mockResolvedValue({ form: { draft: record(true), attachments: [file] }, context })
  open()
  await flushPromises()
  expect(screen.getByText('pay08-owner')).toBeTruthy()
  await fireEvent.update(screen.getByRole('textbox', { name: '业务核验依据' }), '尚未提交的私有依据')
  await useProductionAccessStore().logout()
  await flushPromises()
  expect(screen.queryByRole('region', { name: '历史付款业务核验' })).toBeNull()
  expect(screen.queryByText('pay08-owner')).toBeNull()
  expect(screen.getByRole('region', { name: '财务来源待核实' }).textContent).toContain('登录已失效')
  expect(store.saveForm).not.toHaveBeenCalled()
  await useProductionAccessStore().check()
  await fireEvent.click(screen.getByRole('button', { name: '重试读取来源' }))
  await waitFor(() => expect(screen.getByRole('region', { name: '历史付款业务核验' })).toBeTruthy())
  expect((screen.getByRole('textbox', { name: '业务核验依据' }) as HTMLTextAreaElement).value).toBe('尚未提交的私有依据')
  expect(screen.getByText('pay08-owner')).toBeTruthy()
  expect(store.saveForm).not.toHaveBeenCalled()
})
