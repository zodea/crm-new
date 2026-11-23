import type { TransactionDb } from '../../app/lib/db/coordinator'
import { beforeEach, expect, it, vi } from 'vitest'
import { FinanceRepositoryProblem } from '../../app/lib/finance/central-contract'
import { CentralInvoiceProblem } from '../../app/lib/invoice/central-contract'
import { capturePaymentInvoiceEvidence, verifyPaymentInvoiceScope } from '../../server/utils/production-finance-invoice-adoption'

const capture = vi.hoisted(() => vi.fn())
const verifyContract = vi.hoisted(() => vi.fn())
vi.mock('../../server/utils/production-invoice-service', () => ({ captureProductionInvoiceAdoption: capture }))
vi.mock('../../server/utils/production-finance-contract', () => ({ verifyPaymentContract: verifyContract }))
const actor = { workspaceId: 'synthetic-workspace', actorId: 'synthetic-owner', capabilities: ['finance-invoice:read', 'construction-contract:read', 'subcontract-contract:read', 'material-contract:read', 'auxiliary-contract:read'] }
function fixture(options: { domain?: string | null, invoiceVersion?: number, company?: boolean, allocations?: boolean } = {}) {
  return {
    select: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM payment_applications'))
        return [{ contract_id: options.company ? null : 'contract-one', company_expense_contract_id: options.company ? 'company-one' : null, contract_domain: options.domain === undefined ? (options.company ? null : 'material') : options.domain, contract_version: '1', project_id: options.company ? null : 'project-one', supplier_id: 'supplier-one', biz_type: options.company ? '公司付款' : '预付款' }]
      if (sql.includes('FROM production_participants'))
        return [{ schema_version: params[0] === 'invoices' ? options.invoiceVersion ?? 1 : 1 }]
      if (sql.includes('FROM finance_versions'))
        return [{ version: 2 }]
      if (sql.includes('FROM payment_application_invoice_allocations'))
        return options.allocations === false ? [] : [{ id: 'allocation-one', invoice_id: 'invoice-one' }]
      return []
    },
  } as unknown as TransactionDb
}
beforeEach(() => {
  capture.mockReset()
  verifyContract.mockReset().mockResolvedValue({ supplierId: 'supplier-one' })
})

it('按已选领域核对合同，旧身份、无权限、缺来源及无票均明确拒绝', async () => {
  capture.mockResolvedValue({ id: 'invoice-one', version: '1', contract: { domain: 'material', id: 'contract-one', version: '1' } })
  await expect(capturePaymentInvoiceEvidence(fixture(), actor, 'application-one')).resolves.toMatchObject({ applicationVersion: '2', contract: { domain: 'material', id: 'contract-one' }, invoiceAdoptions: [{ allocationId: 'allocation-one', invoice: { id: 'invoice-one' } }] })
  await expect(capturePaymentInvoiceEvidence(fixture({ invoiceVersion: 2 }), actor, 'application-one')).resolves.toMatchObject({ contract: { domain: 'material', id: 'contract-one' } })
  await expect(capturePaymentInvoiceEvidence(fixture({ invoiceVersion: 3 }), actor, 'application-one')).resolves.toMatchObject({ contract: { domain: 'material', id: 'contract-one' } })
  await expect(capturePaymentInvoiceEvidence(fixture({ invoiceVersion: 4 }), actor, 'application-one')).resolves.toMatchObject({ contract: { domain: 'material', id: 'contract-one' } })
  await expect(capturePaymentInvoiceEvidence(fixture({ invoiceVersion: 5 }), actor, 'application-one')).resolves.toMatchObject({ contract: { domain: 'material', id: 'contract-one' } })
  await expect(capturePaymentInvoiceEvidence(fixture({ invoiceVersion: 6 }), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  expect(verifyContract).toHaveBeenCalledWith(expect.anything(), actor, { domain: 'material', id: 'contract-one', version: '1' }, 'project-one', 'supplier-one', '预付款')
  await expect(capturePaymentInvoiceEvidence(fixture({ domain: null }), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('领域') } })
  verifyContract.mockRejectedValueOnce(new FinanceRepositoryProblem({ code: 'forbidden', message: '合同权限不足' }))
  await expect(capturePaymentInvoiceEvidence(fixture(), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  verifyContract.mockRejectedValueOnce(new FinanceRepositoryProblem({ code: 'unavailable', message: '合同来源不可用' }))
  await expect(capturePaymentInvoiceEvidence(fixture(), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  await expect(capturePaymentInvoiceEvidence(fixture({ allocations: false }), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('指定发票') } })
  await expect(capturePaymentInvoiceEvidence(fixture({ company: true }), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'unavailable', message: expect.stringContaining('领域') } })
  capture.mockResolvedValueOnce({ id: 'invoice-one', version: '1', contract: { domain: 'subcontract', id: 'contract-one', version: '1' } })
  await expect(capturePaymentInvoiceEvidence(fixture(), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'validation-failed', message: expect.stringContaining('合同不一致') } })
  capture.mockResolvedValueOnce({ id: 'invoice-one', version: '1', contract: { domain: 'company', id: 'company-one', version: '1' } })
  await expect(capturePaymentInvoiceEvidence(fixture({ company: true, domain: 'company' }), actor, 'application-one')).resolves.toMatchObject({ contract: { domain: 'company', id: 'company-one', version: '1' } })
  expect(verifyContract).toHaveBeenCalledWith(expect.anything(), actor, { domain: 'company', id: 'company-one', version: '1' }, null, 'supplier-one', '公司付款')
})

it('已有申请的新支付确认重新核对发票归属，旧的错误关联不能继续用于新支付', async () => {
  capture.mockResolvedValueOnce({ id: 'invoice-one', ownerKind: 'project', projectId: 'project-one' })
  await expect(verifyPaymentInvoiceScope(fixture({ company: true }), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  capture.mockResolvedValueOnce({ id: 'invoice-one', ownerKind: 'company', projectId: null })
  await expect(verifyPaymentInvoiceScope(fixture(), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  capture.mockResolvedValueOnce({ id: 'invoice-one', ownerKind: 'personal', projectId: null })
  await expect(verifyPaymentInvoiceScope(fixture({ company: true }), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'validation-failed' } })
  capture.mockResolvedValueOnce({ id: 'invoice-one', ownerKind: 'project', projectId: 'project-one' })
  await expect(verifyPaymentInvoiceScope(fixture(), actor, 'application-one')).resolves.toBeUndefined()
  capture.mockRejectedValueOnce(new CentralInvoiceProblem('forbidden', '发票权限已失效'))
  await expect(verifyPaymentInvoiceScope(fixture(), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'forbidden' } })
  capture.mockRejectedValueOnce(new CentralInvoiceProblem('conflict', '发票来源版本已变化'))
  await expect(verifyPaymentInvoiceScope(fixture(), actor, 'application-one')).rejects.toMatchObject({ problem: { code: 'conflict' } })
})
