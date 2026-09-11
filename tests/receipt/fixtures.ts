import type { ReceiptCommand, ReceiptDraft } from '../../app/lib/receipt/contract'

export const session = { workspaceId: 'workspace-a', actorId: 'actor-a', capabilities: ['receipt:read', 'receipt:write', 'project:list:read', 'customer:list:read', 'construction-contract:read'] }
export const references = {
  projects: [{ id: 'project-a', name: '项目甲', customerId: 'customer-a' }],
  customers: [{ id: 'customer-a', name: '甲方客户' }],
  contracts: [{ id: 'contract-a', no: 'SG-01', name: '施工合同', projectId: 'project-a', customerId: 'customer-a', amount: '1000.00', status: 'signed' }],
}
export const draft: ReceiptDraft = {
  no: 'SK-01',
  receiptDate: '2026-09-10',
  projectId: 'project-a',
  contractId: null,
  customerId: 'customer-a',
  payerAccount: '622200001',
  amount: '120.35',
  paymentMethod: '承兑汇票',
  acceptanceBillNo: 'CD-01',
  billDueDate: '2026-12-10',
  periodNo: '第三期',
  bankSerialNo: '',
  handler: '经办甲',
  reviewStatus: '待审核',
  status: 'draft',
  note: '真实收款说明',
}
export function command(overrides: Partial<ReceiptCommand> = {}): ReceiptCommand {
  return {
    workspaceId: session.workspaceId,
    actorId: session.actorId,
    requiredCapability: 'receipt:write',
    commandId: 'create-a',
    baseVersion: null,
    origin: 'real',
    action: 'submit',
    draft,
    attachments: {},
    ...overrides,
  }
}
