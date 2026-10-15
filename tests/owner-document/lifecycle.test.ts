import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useOwnerDocumentLifecycle } from '~/composables/useOwnerDocumentLifecycle'

const auditOwnerReport = vi.fn().mockResolvedValue(undefined)
const confirm = vi.fn().mockResolvedValue(true)
const warning = vi.fn()
const transitionAcceptance = vi.fn().mockResolvedValue(undefined)

describe('甲方月度报量审定生命周期', () => {
  beforeEach(() => {
    auditOwnerReport.mockClear()
    confirm.mockClear()
    warning.mockClear()
    transitionAcceptance.mockClear()
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      auditOwnerReport,
      transitionAcceptance,
    }))
    vi.stubGlobal('useKitUI', () => ({
      confirm,
      success: vi.fn(),
      warning,
      error: vi.fn(),
    }))
  })

  it('拒绝未填写的审定量，同时允许用户显式填写 0', async () => {
    const draft = ref({
      status: 'reported',
      lines: [{ boqLineId: 'boq-line-323', auditedQty: null, unitPrice: 52 }],
    })
    const lifecycle = useOwnerDocumentLifecycle({
      kind: 'owner_report',
      draft,
      routeId: computed(() => 'report-323'),
      label: computed(() => '甲方报量'),
      refresh: vi.fn().mockResolvedValue(undefined),
    })

    await lifecycle.auditReport()
    expect(warning).toHaveBeenCalledWith('请为每条报量明细填写有效的审定量')
    expect(confirm).not.toHaveBeenCalled()
    expect(auditOwnerReport).not.toHaveBeenCalled()

    draft.value.lines[0]!.auditedQty = 0
    await lifecycle.auditReport()
    expect(confirm).toHaveBeenCalled()
    expect(auditOwnerReport).toHaveBeenCalledWith(
      'report-323',
      expect.objectContaining({ lines: [expect.objectContaining({ auditedQty: 0 })] }),
      draft.value,
    )
  })

  it('保修到期命令成功后结束表单流程并返回来源详情', async () => {
    const complete = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    const draft = ref({
      status: 'warranty',
      warrantyConfirmationOrganization: '建设单位保修验收组',
      warrantyConfirmationDate: '2028-07-18',
      warrantyConfirmationNote: '保修责任履行完毕',
    })
    const lifecycle = useOwnerDocumentLifecycle({
      kind: 'acceptance',
      draft,
      routeId: computed(() => 'acceptance-real-324'),
      label: computed(() => '竣工验收·保修'),
      refresh,
      complete,
      acceptanceAttachments: () => ({
        add: [{ fileName: '保修到期确认单.pdf', category: 'warranty-confirmation' }],
        removeIds: [],
        restoreIds: [],
      }),
      clearAcceptanceAttachments: vi.fn(),
    })

    await lifecycle.moveAcceptance()

    expect(transitionAcceptance).toHaveBeenCalledWith(
      'acceptance-real-324',
      'expired',
      draft.value,
      {
        add: [{ fileName: '保修到期确认单.pdf', category: 'warranty-confirmation' }],
        removeIds: [],
        restoreIds: [],
      },
    )
    expect(complete).toHaveBeenCalledOnce()
    expect(refresh).not.toHaveBeenCalled()
  })
})
