import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  KeepAlive,
  nextTick,
  onActivated,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
} from 'vue'
import OwnerDocumentFormPage from '~/components/owner-document/OwnerDocumentFormPage.vue'
import { ownerCommercialDocumentProblem, OwnerCommercialDocumentRepositoryProblem } from '~/lib/owner-document/central-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'

vi.mock('vue-router', () => ({
  onBeforeRouteLeave: vi.fn(),
}))
vi.mock('~/lib/read-model/authority', () => ({ bindReadAuthority: vi.fn() }))

vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn,
  }
})

const route = {
  fullPath: '/owner/change/new',
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
}
const loadOne = vi.fn()
const loadAttachments = vi.fn()
const loadContractOptions = vi.fn()
const loadContractSummary = vi.fn()
const loadBoqLines = vi.fn()
const confirm = vi.fn()
const saveForm = vi.fn()
const saveAttachments = vi.fn()
const hydrateCommand = vi.fn()

const EntityFormShellStub = defineComponent({
  props: {
    title: { type: String, required: true },
    backLabel: { type: String, default: '' },
    sections: { type: Array, default: () => [] },
    state: { type: String, default: 'ready' },
    stateTitle: { type: String, default: '' },
    stateDescription: { type: String, default: '' },
    stateActionLabel: { type: String, default: '' },
  },
  emits: ['stateAction'],
  setup(props, { emit, slots }) {
    return () => h('main', { 'data-testid': 'owner-document-form-shell' }, [
      h('h1', props.title),
      slots.status?.(),
      h('button', { type: 'button' }, props.backLabel),
      h('p', { 'data-testid': 'sections' }, (props.sections as Array<{ label: string }>).map(section => section.label).join('|')),
      props.state === 'error'
        ? h('section', { role: 'alert' }, [
            h('p', props.stateTitle),
            h('p', props.stateDescription),
            h('button', {
              type: 'button',
              onClick: () => emit('stateAction'),
            }, props.stateActionLabel),
          ])
        : null,
      props.state === 'ready' ? slots.default?.() : null,
    ])
  },
})

const OwnerDocumentFormFieldsStub = defineComponent({
  props: {
    kind: { type: String, default: '' },
    draft: { type: Object, required: true },
    fieldErrors: { type: Object, required: true },
    readonly: { type: Boolean, default: false },
  },
  emits: ['patch'],
  setup(props, { emit }) {
    return () => h('section', [
      h('input', {
        'aria-label': '变更名称',
        'data-field': 'name',
        'aria-invalid': Boolean(props.fieldErrors.name),
        'readonly': props.readonly,
        'value': String(props.draft.name ?? ''),
      }),
      props.draft.status === 'accepted'
        ? h('div', [
            h('output', { 'data-testid': 'acceptance-draft' }, JSON.stringify(props.draft)),
            h('button', { type: 'button', onClick: () => emit('patch', { warrantyStartDate: '2026-09-11' }) }, '填写保修日期'),
          ])
        : null,
      props.draft.quantityBasis
        ? h('div', [
            h('output', { 'data-testid': 'report-draft' }, JSON.stringify(props.draft)),
            h('button', { type: 'button', onClick: () => emit('patch', { quantityBasis: 'contract' }) }, '切换合同量'),
            h('button', { type: 'button', onClick: () => emit('patch', { name: '等待期间编辑' }) }, '修改报量名称'),
          ])
        : null,
      ['final_settlement', 'sub_settlement'].includes(props.kind)
        ? h('div', [
            h('output', { 'data-testid': 'settlement-draft' }, JSON.stringify(props.draft)),
            h('button', { type: 'button', onClick: () => emit('patch', { contractId: 'contract-a' }) }, '选择合同甲'),
            h('button', { type: 'button', onClick: () => emit('patch', { contractId: 'contract-b' }) }, '选择合同乙'),
            h('button', { type: 'button', onClick: () => emit('patch', { projectId: null }) }, '清空结算项目'),
          ])
        : null,
    ])
  },
})

const FormFooterStub = defineComponent({
  props: {
    actions: { type: Array, default: () => [] },
  },
  emits: ['action'],
  setup(props, { emit }) {
    return () => h('div', [
      ...(props.actions as string[]).includes('saveSubmit')
        ? [h('button', {
            type: 'button',
            onClick: () => emit('action', 'saveSubmit'),
          }, '保存并提交')]
        : [],
      ...(props.actions as string[]).includes('save')
        ? [h('button', {
            type: 'button',
            onClick: () => emit('action', 'save'),
          }, '保存附件')]
        : [],
    ])
  },
})

const OwnerDocumentLineGridStub = defineComponent({
  props: { error: { type: String, default: '' } },
  setup(props) {
    return () => props.error
      ? h('p', { 'data-field': 'lines', 'tabindex': '-1', 'role': 'alert' }, props.error)
      : h('section')
  },
})

const FileRefAttachmentSectionStub = defineComponent({
  props: { readonly: { type: Boolean, default: false } },
  setup(props) {
    return () => h('section', [
      props.readonly ? null : h('button', { type: 'button' }, '选择附件'),
    ])
  },
})

const global = {
  components: {
    EntityFormShell: EntityFormShellStub,
    FileRefAttachmentSection: FileRefAttachmentSectionStub,
    FormFooter: FormFooterStub,
  },
  stubs: {
    OwnerDocumentFormFields: OwnerDocumentFormFieldsStub,
    OwnerDocumentLineGrid: OwnerDocumentLineGridStub,
  },
}

describe('甲方与分包单据整页表单状态', () => {
  beforeEach(() => {
    route.fullPath = '/owner/change/new'
    route.params = {}
    route.query = {}
    loadOne.mockReset()
    loadAttachments.mockReset()
    loadContractOptions.mockReset()
    loadContractSummary.mockReset().mockResolvedValue(null)
    loadBoqLines.mockReset().mockResolvedValue([])
    confirm.mockReset().mockResolvedValue(true)
    saveForm.mockReset()
    saveAttachments.mockReset()
    hydrateCommand.mockReset().mockResolvedValue(null)
    loadOne.mockResolvedValue(null)
    loadAttachments.mockResolvedValue([])
    loadContractOptions.mockResolvedValue([])
    saveForm.mockResolvedValue({ id: 'owner-document-id' })

    vi.stubGlobal('computed', computed)
    vi.stubGlobal('nextTick', nextTick)
    vi.stubGlobal('onMounted', onMounted)
    vi.stubGlobal('onActivated', onActivated)
    vi.stubGlobal('onDeactivated', onDeactivated)
    vi.stubGlobal('ref', ref)
    vi.stubGlobal('shallowRef', shallowRef)
    vi.stubGlobal('useRoute', () => route)
    vi.stubGlobal('useRouter', () => ({ push: vi.fn().mockResolvedValue(undefined) }))
    vi.stubGlobal('navigateTo', vi.fn())
    vi.stubGlobal('useTabTitle', vi.fn())
    vi.stubGlobal('useTabsStore', () => ({ registerCloseGuard: () => () => {}, tabs: [], close: vi.fn(), open: vi.fn() }))
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      loadOne,
      loadAttachments,
      loadBasicOptions: vi.fn().mockResolvedValue([]),
      loadContractOptions,
      loadBoqLines,
      loadContractSummary,
      saveForm,
      saveAttachments,
      pendingCommand: () => null,
      hydrateCommand,
      recoverCommand: vi.fn(),
      lookupVersion: () => null,
      refreshRelationshipVersions: async () => undefined,
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }))
    vi.stubGlobal('useOwnerDocumentFormAttachments', () => ({
      attachments: ref([]),
      pendingAttachments: ref([]),
      pendingRemoveIds: ref([]),
      pendingRestoreIds: ref([]),
      readingFiles: ref(false),
      dirty: ref(false),
      reset: vi.fn(),
      clearPending: vi.fn(),
      changes: () => ({ add: [], removeIds: [], restoreIds: [] }),
      capture: () => ({ add: [], removeIds: [], restoreIds: [] }),
      acknowledge: vi.fn(),
      handleFiles: vi.fn(),
      toggleExisting: vi.fn(),
      removePending: vi.fn(),
      patchPending: vi.fn(),
    }))
    vi.stubGlobal('useOwnerDocumentLifecycle', () => ({
      loading: ref(false),
      auditMode: ref(false),
      canApproveChange: ref(false),
      acceptanceAction: ref(null),
      approveChange: vi.fn(),
      moveAcceptance: vi.fn(),
      auditReport: vi.fn(),
    }))
  })

  it('已删草稿经原key冷恢复后保持只读，无保存提交与附件写入口，并可返回列表', async () => {
    route.fullPath = '/owner/penalty/form/deleted-original'
    route.params = { id: 'deleted-original' }
    hydrateCommand.mockResolvedValue({ recovered: true, form: { kind: 'owner_penalty', id: 'deleted-original', draft: { id: 'deleted-original', no: 'DELETED-ORIGINAL', status: 'draft', name: '原已删草稿', reason: '原原因', amount: null, lines: [] }, attachments: [], version: '2', updatedAt: '2026-10-08T00:00:00.000Z', readOnly: true, deletionVerification: { commandId: 'original-delete-key', deletedAt: '2026-10-08T00:00:00.000Z' } } })
    render(OwnerDocumentFormPage, { props: { kind: 'owner_penalty' }, global })
    await screen.findByText('原单据已删除，当前仅供核对。可返回列表查看其他单据。')
    expect(screen.getByRole('textbox', { name: '变更名称' }).getAttribute('readonly')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '保存并提交' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存附件' })).toBeNull()
    expect(screen.queryByRole('button', { name: '选择附件' })).toBeNull()
    expect(screen.getByRole('button', { name: '返回甲方罚扣单' })).not.toBeNull()
    expect(loadContractSummary).not.toHaveBeenCalled()
    expect(saveForm).not.toHaveBeenCalled()
  })

  it('原已删结算使旧合同读取失效，页签返回和迟到来源不能改原金额或重开写入口', async () => {
    route.fullPath = '/subcontract/settlement/form/deleted-settlement'
    route.params = { id: 'deleted-settlement' }
    const form = { kind: 'sub_settlement', id: 'deleted-settlement', draft: { id: 'deleted-settlement', no: 'ORIGINAL-DELETED', name: '原已删结算', status: 'draft', projectId: 'project-original', contractId: 'contract-original', totalAmount: null, contractAmount: 1234, priorSettlementAmount: null, lines: [] }, attachments: [], version: '2', updatedAt: '2026-10-08T00:00:00.000Z' }
    hydrateCommand.mockResolvedValueOnce({ recovered: false, form }).mockResolvedValue({ recovered: true, form: { ...form, readOnly: true, deletionVerification: { commandId: 'original-delete-key', deletedAt: '2026-10-08T00:00:00.000Z' } } })
    let finish!: (value: unknown) => void
    loadContractSummary.mockReturnValueOnce(new Promise(resolve => finish = resolve))
    const visible = ref(true)
    render(defineComponent({
      setup: () => () => h(KeepAlive, () => visible.value ? h(OwnerDocumentFormPage, { kind: 'sub_settlement' }) : null),
    }), { global })
    await waitFor(() => expect(loadContractSummary).toHaveBeenCalledTimes(1))
    vi.mocked(bindReadAuthority).mock.calls.at(-1)![0](ownerCommercialDocumentProblem('unavailable', '原读取已失效'))
    await fireEvent.click(await screen.findByRole('button', { name: '重新载入' }))
    await screen.findByText('原单据已删除，当前仅供核对。可返回列表查看其他单据。')
    finish({ contractAmount: 99999, priorSettlementAmount: 77 })
    await flushPromises()
    visible.value = false
    await nextTick()
    route.fullPath = '/subcontract/settlement'
    await nextTick()
    route.fullPath = '/subcontract/settlement/form/deleted-settlement'
    visible.value = true
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '选择合同乙' }))
    await flushPromises()
    expect(JSON.parse(screen.getByTestId('settlement-draft').textContent!)).toMatchObject({ contractId: 'contract-original', contractAmount: 1234, priorSettlementAmount: null, totalAmount: null })
    expect(loadContractSummary).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: '改用服务器最新版' })).toBeNull()
    expect(screen.queryByRole('button', { name: '保存并提交' })).toBeNull()
    expect(screen.queryByRole('button', { name: '选择附件' })).toBeNull()
  })

  function prepareReport(status = 'draft') {
    route.fullPath = '/owner/report/form/monthly-current'
    route.params = { id: 'monthly-current' }
    loadOne.mockResolvedValue({
      id: 'monthly-current',
      status,
      name: '九月报量',
      projectId: 'project-current',
      contractId: 'contract-current',
      periodNo: '2026-09',
      quantityBasis: 'field',
      lines: [{ id: 'old-line', boqLineId: 'boq-current', reportedQty: 17, unitPrice: 20 }],
    })
    loadBoqLines.mockImplementation(async (_project, _contract, _period, basis) => [{
      id: 'boq-current',
      itemName: '墙面',
      unit: '㎡',
      qty: 100,
      unitPrice: 20,
      autoQty: basis === 'contract' ? 0 : 9,
      missingQtyCount: 0,
    }])
  }

  it('报量提交保生成时实际采用版本，来源冲突仅显式刷新后换token且保手工量', async () => {
    prepareReport()
    loadOne.mockResolvedValue({ id: 'monthly-current', status: 'draft', projectId: 'project-current', contractId: 'contract-current', periodNo: '2026-09', quantityBasis: 'field', applicationDate: '2026-09-30', lines: [{ boqLineId: 'boq-current', reportedQty: 17, unitPrice: 20 }] })
    const first = { id: 'boq-current', itemName: '墙面', unit: '㎡', qty: 100, unitPrice: 20, autoQty: 9, missingQtyCount: 0, quantityConsumedVersion: 'quantity-original', quantitySourceVersion: 'full-original', quantitySourceUpdatedAt: '2026-10-07T08:00:00.000Z' }
    loadBoqLines.mockResolvedValue([first])
    saveForm.mockRejectedValue(new OwnerCommercialDocumentRepositoryProblem(ownerCommercialDocumentProblem('stale-source', '实际完成量来源已变化')))
    render(OwnerDocumentFormPage, { props: { kind: 'owner_report' }, global })
    await waitFor(() => expect(screen.getByTestId('report-draft').textContent).toContain('quantity-original'))
    const originalReads = loadBoqLines.mock.calls.length
    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))
    await waitFor(() => expect(saveForm).toHaveBeenCalled())
    expect(saveForm).toHaveBeenCalledWith('owner_report', expect.objectContaining({ quantityConsumedVersion: 'quantity-original', quantitySourceVersion: 'full-original', lines: [expect.objectContaining({ reportedQty: 17 })] }), 'submit', expect.any(Object))
    expect(loadBoqLines.mock.calls).toHaveLength(originalReads)
    loadBoqLines.mockResolvedValue([{ ...first, unitPrice: 30, autoQty: 12, quantityConsumedVersion: 'quantity-current', quantitySourceVersion: 'full-current' }])
    await fireEvent.click(await screen.findByRole('button', { name: '重新读取依据并保留手工量' }))
    await waitFor(() => expect(screen.getByTestId('report-draft').textContent).toContain('quantity-current'))
    const current = JSON.parse(screen.getByTestId('report-draft').textContent!)
    expect(current.lines[0]).toMatchObject({ reportedQty: 17, autoQty: 12, unitPrice: 30 })
    expect(current.reportedAmount).toBe(510)
  })

  const SETTLEMENT_CASES = [
    {
      kind: 'final_settlement' as const,
      path: '/owner/final-settlement/form/settlement-current',
      amount: { settlementAmount: 100 },
      expected: { changedContractAmount: 250, receivedAmount: 18, settlementReceiptGap: 82 },
      cleared: { changedContractAmount: null, receivedAmount: null, settlementReceiptGap: null },
    },
    {
      kind: 'sub_settlement' as const,
      path: '/subcontract/settlement/form/settlement-current',
      amount: { totalAmount: 100 },
      expected: { contractAmount: 250, priorSettlementAmount: 20, settlementRatio: '40.00%' },
      cleared: { contractAmount: null, priorSettlementAmount: null, settlementRatio: null },
    },
  ]
  const OLD_SUMMARY = { contractAmount: 100, receivedAmount: 7, priorSettlementAmount: 10 }
  const CURRENT_SUMMARY = { contractAmount: 250, receivedAmount: 18, priorSettlementAmount: 20 }

  function prepareSettlement(input: typeof SETTLEMENT_CASES[number]) {
    route.fullPath = input.path
    route.params = { id: 'settlement-current' }
    loadOne.mockResolvedValue({ id: 'settlement-current', status: 'draft', name: '摘要竞态结算', projectId: 'project-current', contractId: null, ...input.amount })
  }

  it.each(SETTLEMENT_CASES)('$kind 切换合同后拒绝迟到旧摘要，不混入另一合同金额', async (input) => {
    prepareSettlement(input)
    render(OwnerDocumentFormPage, { props: { kind: input.kind }, global })
    await flushPromises()
    let completeOld!: (summary: typeof OLD_SUMMARY) => void
    loadContractSummary.mockImplementationOnce(() => new Promise((resolve) => {
      completeOld = resolve
    }))
      .mockResolvedValueOnce(CURRENT_SUMMARY)
    await fireEvent.click(screen.getByRole('button', { name: '选择合同甲' }))
    await fireEvent.click(screen.getByRole('button', { name: '选择合同乙' }))
    await flushPromises()
    expect(JSON.parse(screen.getByTestId('settlement-draft').textContent!)).toMatchObject({ contractId: 'contract-b', ...input.expected })
    completeOld(OLD_SUMMARY)
    await flushPromises()
    expect(JSON.parse(screen.getByTestId('settlement-draft').textContent!)).toMatchObject({ contractId: 'contract-b', ...input.expected })
  })

  it.each(SETTLEMENT_CASES)('$kind 清空项目后拒绝迟到摘要，派生金额保持未记录', async (input) => {
    prepareSettlement(input)
    render(OwnerDocumentFormPage, { props: { kind: input.kind }, global })
    await flushPromises()
    let completeOld!: (summary: typeof OLD_SUMMARY) => void
    loadContractSummary.mockImplementationOnce(() => new Promise((resolve) => {
      completeOld = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '选择合同甲' }))
    await fireEvent.click(screen.getByRole('button', { name: '清空结算项目' }))
    completeOld(OLD_SUMMARY)
    await flushPromises()
    expect(JSON.parse(screen.getByTestId('settlement-draft').textContent!)).toMatchObject({ projectId: null, contractId: null, ...input.cleared })
  })

  it.each(SETTLEMENT_CASES)('$kind 离开缓存页后拒绝旧摘要，返回重新读取当前合同', async (input) => {
    prepareSettlement(input)
    const visible = ref(true)
    render(defineComponent({
      setup: () => () => h(KeepAlive, () => visible.value ? h(OwnerDocumentFormPage, { kind: input.kind }) : null),
    }), { global })
    await flushPromises()
    let completeOld!: (summary: typeof OLD_SUMMARY) => void
    loadContractSummary.mockImplementationOnce(() => new Promise((resolve) => {
      completeOld = resolve
    }))
      .mockResolvedValueOnce(CURRENT_SUMMARY)
    await fireEvent.click(screen.getByRole('button', { name: '选择合同甲' }))
    visible.value = false
    route.fullPath = '/'
    await nextTick()
    route.fullPath = input.path
    visible.value = true
    await flushPromises()
    completeOld(OLD_SUMMARY)
    await flushPromises()
    expect(JSON.parse(screen.getByTestId('settlement-draft').textContent!)).toMatchObject({ contractId: 'contract-a', ...input.expected })
    expect(loadOne).toHaveBeenCalledTimes(1)
  })

  it('月报离开缓存页再返回后拒绝旧取数响应，重新读取当前基准且保留手工稿', async () => {
    prepareReport()
    const visible = ref(true)
    render(defineComponent({
      setup: () => () => h(KeepAlive, () => visible.value ? h(OwnerDocumentFormPage, { kind: 'owner_report' }) : null),
    }), { global })
    await flushPromises()
    let completeOld!: (rows: unknown[]) => void
    loadBoqLines.mockImplementationOnce(() => new Promise((resolve) => {
      completeOld = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '切换合同量' }))
    await flushPromises()
    visible.value = false
    route.fullPath = '/owner/report'
    await nextTick()
    route.fullPath = '/owner/report/form/monthly-current'
    visible.value = true
    await flushPromises()
    completeOld([{ id: 'boq-current', itemName: '过期读数', unit: '㎡', qty: 100, unitPrice: 20, autoQty: 99, missingQtyCount: 0 }])
    await flushPromises()
    const current = JSON.parse(screen.getByTestId('report-draft').textContent!)
    expect(current.quantityBasis).toBe('contract')
    expect(current.lines[0].autoQty).toBe(0)
    expect(current.lines[0].reportedQty).toBe(0)
    expect(loadOne).toHaveBeenCalledTimes(1)
  })

  it('更换报量基准取消保留手工稿，确认后重新生成全部明细并保留明确零', async () => {
    prepareReport()
    render(OwnerDocumentFormPage, { props: { kind: 'owner_report' }, global })
    await flushPromises()
    confirm.mockResolvedValueOnce(false)
    await fireEvent.click(screen.getByRole('button', { name: '切换合同量' }))
    await flushPromises()
    let current = JSON.parse(screen.getByTestId('report-draft').textContent!)
    expect(current.quantityBasis).toBe('field')
    expect(current.lines[0].reportedQty).toBe(17)
    expect(loadBoqLines).toHaveBeenCalledTimes(1)
    await fireEvent.click(screen.getByRole('button', { name: '切换合同量' }))
    await flushPromises()
    current = JSON.parse(screen.getByTestId('report-draft').textContent!)
    expect(current.quantityBasis).toBe('contract')
    expect(current.lines[0]).toMatchObject({ autoQty: 0, reportedQty: 0 })
    expect(current.lines[0].id).toBeUndefined()
    expect(current.reportedAmount).toBe(0)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('手工申报量') }))
  })

  it('基准确认等待期间草稿已变化时不覆盖新编辑，已生效单据拒绝更换', async () => {
    prepareReport()
    const view = render(OwnerDocumentFormPage, { props: { kind: 'owner_report' }, global })
    await flushPromises()
    let release!: (value: boolean) => void
    confirm.mockReturnValueOnce(new Promise<boolean>((resolve) => {
      release = resolve
    }))
    await fireEvent.click(screen.getByRole('button', { name: '切换合同量' }))
    await fireEvent.click(screen.getByRole('button', { name: '修改报量名称' }))
    release(true)
    await flushPromises()
    expect(JSON.parse(screen.getByTestId('report-draft').textContent!)).toMatchObject({ name: '等待期间编辑', quantityBasis: 'field' })
    view.unmount()
    prepareReport('reported')
    confirm.mockClear()
    render(OwnerDocumentFormPage, { props: { kind: 'owner_report' }, global })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '切换合同量' }))
    await flushPromises()
    expect(JSON.parse(screen.getByTestId('report-draft').textContent!).quantityBasis).toBe('field')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('uses the dynamic title, return label and sections from the document kind', async () => {
    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global,
    })
    await flushPromises()

    expect(screen.getByRole('heading', { name: '新建 · 甲方变洽签' })).not.toBeNull()
    expect(screen.getByRole('button', { name: '返回甲方变洽签' })).not.toBeNull()
    expect(screen.getByTestId('sections').textContent)
      .toBe('基本信息|变更明细|附件与备注')
  })

  it('月报只读保护不阻止验收单当前生命周期允许填写的保修字段', async () => {
    route.fullPath = '/owner/acceptance/form/current'
    route.params = { id: 'current' }
    loadOne.mockResolvedValue({ id: 'current', name: '验收', status: 'accepted', warrantyStartDate: null })
    render(OwnerDocumentFormPage, { props: { kind: 'acceptance' }, global })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '填写保修日期' }))
    expect(JSON.parse(screen.getByTestId('acceptance-draft').textContent!).warrantyStartDate).toBe('2026-09-11')
  })

  it('hides the writable form after a load failure and retries in place', async () => {
    route.fullPath = '/owner/change/change-real'
    route.params = { id: 'change-real' }
    loadOne.mockRejectedValueOnce(new Error('数据库暂不可用'))
      .mockResolvedValueOnce({
        id: 'change-real',
        status: 'draft',
        name: '现场签证',
        projectId: null,
        contractId: null,
        lines: [],
      })

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global,
    })
    await flushPromises()

    expect(screen.getByRole('alert').textContent).toContain('数据库暂不可用')
    expect(screen.queryByRole('textbox', { name: '变更名称' })).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: '重新载入' }))
    await flushPromises()

    expect(screen.getByRole('textbox', { name: '变更名称' })).not.toBeNull()
    expect(loadOne).toHaveBeenCalledTimes(2)
  })

  it.each([
    { state: 'draft', label: '草稿', editable: true },
    { state: 'submitted', label: '已上报', editable: false },
    { state: 'rejected', label: '已打回', editable: true },
    { state: 'approved', label: '已签证', editable: false },
  ])('甲方变洽签 $state 显示 $label，编辑能力=$editable', async ({ state, label, editable }) => {
    route.fullPath = '/owner/change/change-submitted'
    route.params = { id: 'change-submitted' }
    loadOne.mockResolvedValue({
      id: 'change-submitted',
      status: state,
      name: '已上报签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      lines: [],
    })

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global,
    })
    await flushPromises()

    expect(screen.getByText(label)).not.toBeNull()
    expect(screen.queryByText('已提交')).toBeNull()
    expect(screen.queryByRole('button', { name: '保存并提交' }) !== null).toBe(editable)
    expect(screen.queryByRole('button', { name: '保存附件' }) !== null).toBe(!editable)
  })

  it('focuses the first invalid control before opening the submit confirmation', async () => {
    const confirm = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning: vi.fn(),
      error: vi.fn(),
    }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global,
    })
    await flushPromises()

    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))

    await waitFor(() => {
      const first = screen.getByRole('textbox', { name: '变更名称' })
      expect(first.getAttribute('aria-invalid')).toBe('true')
      expect(document.activeElement).toBe(first)
    })
    expect(confirm).not.toHaveBeenCalled()
    expect(saveForm).not.toHaveBeenCalled()
  })

  it('空变更行在命令前留在页面，并聚焦明细错误', async () => {
    route.fullPath = '/owner/change/change-invalid'
    route.params = { id: 'change-invalid' }
    loadOne.mockResolvedValue({
      id: 'change-invalid',
      status: 'draft',
      name: '无效变更行',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      applicationDate: '2026-08-25',
      reason: '验证明细',
      _centralBaseVersion: '1',
      lines: [{ operation: 'qty', boqLineId: '', deltaQty: null }],
    })

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global,
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
    expect(screen.getByRole('alert').textContent).toContain('BOQ')
    expect(saveForm).not.toHaveBeenCalled()
  })

  it('将中央字段错误映射回明细并聚焦首错', async () => {
    route.fullPath = '/owner/change/change-server-invalid'
    route.params = { id: 'change-server-invalid' }
    loadOne.mockResolvedValue({
      id: 'change-server-invalid',
      status: 'draft',
      name: '纯金额签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      applicationDate: '2026-08-25',
      reason: '服务端二次校验',
      approvedTaxInclusiveAmount: 100,
      _centralBaseVersion: '1',
      lines: [],
    })
    saveForm.mockRejectedValue(new OwnerCommercialDocumentRepositoryProblem({
      code: 'validation-failed',
      message: '变更明细需要修正',
      retryable: false,
      fieldErrors: { lines: ['第 1 行：BOQ 行已失效'] },
      traceId: 'trace-323',
    }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global,
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))
    await flushPromises()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')))
    expect(screen.getByRole('alert').textContent).toContain('BOQ 行已失效')
  })

  it('中央 409 且最新版已受保护时只读保留本页内容并停用所有命令', async () => {
    route.fullPath = '/owner/change/change-draft?origin=real'
    route.params = { id: 'change-draft' }
    route.query = { origin: 'real' }
    loadOne.mockResolvedValueOnce({
      id: 'change-draft',
      status: 'draft',
      name: '本页未提交签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      applicationDate: '2026-08-25',
      reason: '现场调整',
      approvedTaxInclusiveAmount: 100,
      _centralBaseVersion: '1',
      lines: [],
    }).mockResolvedValueOnce({
      id: 'change-draft',
      status: 'submitted',
      name: '服务器最新签证',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      _centralBaseVersion: '2',
      lines: [],
    })
    saveForm.mockRejectedValue(new OwnerCommercialDocumentRepositoryProblem(
      ownerCommercialDocumentProblem('conflict', '中央版本已更新'),
    ))
    const confirm = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), warning: vi.fn(), error: vi.fn() }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_change' },
      global,
    })
    await flushPromises()
    await fireEvent.click(screen.getByRole('button', { name: '保存并提交' }))
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '单据已有新版本',
      confirmLabel: '保留本页供复制',
      cancelLabel: '改用服务器最新版',
    }))
    expect(loadOne).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('status').textContent).toContain('仅供核对和复制')
    const name = screen.getByRole('textbox', { name: '变更名称' }) as HTMLInputElement
    expect(name.value).toBe('本页未提交签证')
    expect(name.readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: '保存并提交' })).toBeNull()
    expect(screen.queryByRole('button', { name: '选择附件' })).toBeNull()
  })

  it('已申报报量同状态附件冲突可换基准重试，不误转只读', async () => {
    route.fullPath = '/owner/report/form/report-reported?origin=real'
    route.params = { id: 'report-reported' }
    route.query = { origin: 'real' }
    const reported = {
      id: 'report-reported',
      status: 'reported',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      periodNo: '2026-08',
      applicationDate: '2026-08-25',
      _centralBaseVersion: '1',
      lines: [{ boqLineId: 'boq-1', reportedQty: 3, auditedQty: 2 }],
    }
    loadOne.mockResolvedValueOnce(reported).mockResolvedValueOnce({
      ...reported,
      _centralBaseVersion: '2',
      lines: [{ boqLineId: 'boq-1', reportedQty: 3, auditedQty: null }],
    })
    saveAttachments.mockRejectedValue(new OwnerCommercialDocumentRepositoryProblem(
      ownerCommercialDocumentProblem('conflict', '中央版本已更新'),
    ))
    const confirm = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('useKitUI', () => ({ confirm, success: vi.fn(), warning: vi.fn(), error: vi.fn() }))

    render(OwnerDocumentFormPage, {
      props: { kind: 'owner_report' },
      global,
    })
    await flushPromises()
    expect(screen.getByRole('button', { name: '选择附件' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保存附件' }))
    await flushPromises()

    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '单据已有新版本',
      confirmLabel: '保留我的内容',
    }))
    expect(screen.queryByText(/仅供核对和复制/)).toBeNull()
    expect(screen.getByRole('button', { name: '保存附件' })).not.toBeNull()
  })

  it('保修到期终态隐藏附件写入和虚假保存入口', async () => {
    route.fullPath = '/owner/acceptance/form/acceptance-expired-324?origin=real'
    route.params = { id: 'acceptance-expired-324' }
    route.query = { origin: 'real' }
    loadOne.mockResolvedValue({
      id: 'acceptance-expired-324',
      status: 'expired',
      name: '已到期验收记录',
      projectId: 'project-owner',
      contractId: 'contract-owner',
      lines: [],
    })

    render(OwnerDocumentFormPage, {
      props: { kind: 'acceptance' },
      global,
    })
    await flushPromises()

    expect(screen.queryByRole('button', { name: '保存附件' })).toBeNull()
    expect(screen.queryByRole('button', { name: '选择附件' })).toBeNull()
  })
})
