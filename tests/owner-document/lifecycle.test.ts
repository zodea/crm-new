import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useOwnerDocumentLifecycle } from '~/composables/useOwnerDocumentLifecycle'

const auditOwnerReport = vi.fn().mockResolvedValue(undefined)
const confirm = vi.fn().mockResolvedValue(true)
const warning = vi.fn()

describe('甲方月度报量审定生命周期', () => {
  beforeEach(() => {
    auditOwnerReport.mockClear()
    confirm.mockClear()
    warning.mockClear()
    vi.stubGlobal('useOwnerDocumentStore', () => ({
      auditOwnerReport,
      loadDeductions: vi.fn().mockResolvedValue([]),
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
})
