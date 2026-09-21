import type { PayrollActualLedgerRead } from '~/lib/payroll/central-actual-contract'
import type { PayrollStatementRow } from '~/lib/payroll/central-contract'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PayrollWorkbookArchiveDialog from '~/components/payroll/PayrollWorkbookArchiveDialog.vue'
import { payrollUiDocument } from '../helpers/payroll-a-ui-fixture'
import { c1Frozen } from '../helpers/payroll-c1-ui'
import { c2Frozen } from '../helpers/payroll-c2-ui'

const a = { ...payrollUiDocument(), projectId: 'project', projectName: '真实项目' }
const c1 = { ...c1Frozen(), id: 'c1', projectId: 'project', projectName: '真实项目' }
const c2 = { ...c2Frozen(), id: 'c2', projectId: 'project', projectName: '真实项目', month: '2026-09' }

function row(document: typeof a | typeof c1 | typeof c2): PayrollStatementRow {
  return { id: document.id, recordKind: 'central', legacyId: null, projectId: document.projectId, projectName: document.projectName, crewId: 'crewId' in document ? document.crewId : null, crewName: document.crewName, leaderWorkerId: `leader-${document.formatFamily}`, leaderName: document.leaderName, subjectConfigId: null, month: document.month, formatFamily: document.formatFamily, periodKind: document.periodKind, purpose: '', quantitySource: '', status: 'released', needsRecheck: false, payRatio: document.payRatio, cumulativeAmount: document.formatFamily === 'A' ? document.cumulativeAmount : null, previouslyPaid: document.formatFamily === 'A' ? document.previouslyPaid : null, grossAmount: document.grossAmount, actualAmount: document.actualAmount, checkedAt: null, releasedAt: document.releasedAt, submittedAt: null, updatedAt: null, deletedAt: null, hidden: false, sourceVersion: 'row-v1', note: null, snapshot: { state: 'complete', raw: '{}', originalRaw: null, data: {}, issues: [] }, ...(document.formatFamily === 'A' ? { book: { bookPurpose: 'ordinary' as const, managementBookId: null } } : {}) }
}

const exportFile = vi.fn()
const repository = {
  list: vi.fn(async () => ({ rows: [row(a), row(c1), row(c2)], projects: [], diagnostics: [] })),
  aOutput: vi.fn(async () => ({ state: 'available', document: a, reasons: [] })),
  c1Output: vi.fn(async () => ({ state: 'available', document: c1, reasons: [] })),
  c2Output: vi.fn(async () => ({ state: 'available', document: c2, reasons: [] })),
  actualLedger: vi.fn(async (_query, scope): Promise<PayrollActualLedgerRead> => ({ context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'actual-v1', capabilities: ['payroll:read'], readonly: false }, scope, sourceVersion: 'actual-v1', status: 'complete', rows: [], netAmount: { value: 1000, knownValue: 1000, state: 'known', reasons: [] }, diagnostics: [] })),
}
const stubs = {
  Dialog: { template: '<div><slot /></div>' },
  DialogContent: { template: '<div><slot /></div>' },
  DialogDescription: { template: '<p><slot /></p>' },
  DialogFooter: { template: '<footer><slot /></footer>' },
  DialogTitle: { template: '<h2><slot /></h2>' },
  KitButton: { template: '<button><slot /></button>' },
}

beforeEach(() => {
  vi.clearAllMocks()
  exportFile.mockResolvedValue({ status: 'exported', displayPath: '下载' })
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repository } }))
  vi.stubGlobal('useKitUI', () => ({ exportFile }))
})
afterEach(() => vi.unstubAllGlobals())

describe('完整工资工作簿窗口', () => {
  it('从项目全部已发冻结工资生成真实按月 ZIP，并明确编号和名册未决边界', async () => {
    const wrapper = mount(PayrollWorkbookArchiveDialog, { props: { open: true, context: { workspaceId: 'workspace', actorId: 'actor', origin: 'real', sourceVersion: 'read-v1', capabilities: ['payroll:read'], readonly: true }, projectId: 'project', projectName: '真实项目' }, global: { stubs } })
    await flushPromises()
    expect(repository.list).toHaveBeenCalledWith({ origin: 'real', projectId: 'project' })
    expect(wrapper.text()).toContain('正式编号暂不分配')
    expect(wrapper.text()).toContain('实名名册、证件照和银行卡照暂不归档')
    await wrapper.find('input[value="project-month"]').setValue(true)
    await wrapper.findAll('button').find(button => button.text().includes('生成按月 ZIP 归档'))!.trigger('click')
    await flushPromises()
    expect(repository.actualLedger).toHaveBeenCalledTimes(2)
    expect(exportFile).toHaveBeenCalledWith(expect.objectContaining({ defaultName: '真实项目-按月工资归档-编号待定.zip', mimeType: 'application/zip' }))
    wrapper.unmount()
  })
})
