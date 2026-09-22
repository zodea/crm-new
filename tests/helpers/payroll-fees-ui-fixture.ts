import type { PayrollAFeeConfigRead, PayrollAFeeDraft, PayrollAFeesFormRead, PayrollAFeesFrozenDocument, PayrollAFeesSourceSnapshot, PayrollAManagementBookRead, PayrollANegativeLineDraft } from '~/lib/payroll/central-a-fees-contract'
import { payrollUiConfig, payrollUiDocument, payrollUiFact, payrollUiForm } from './payroll-a-ui-fixture'

export const feeAmount = (value: number) => ({ value, knownValue: value, state: 'known' as const, reasons: [] })
export function feeManagementBook(): PayrollAManagementBookRead {
  return { book: { id: 'management-book', projectId: 'project', managerWorkerId: 'worker', createdBy: 'actor', createdAt: '2026-09-01', deletedAt: null }, revision: { id: 'management-revision', managementBookId: 'management-book', projectId: 'project', revision: 1, effectiveMonth: '2026-09', managementMode: 'crew-managed', scope: { assignments: [{ assignmentId: 'assignment-original', scopeIds: ['scope-original'], cells: [{ unitId: 'unit', roomId: 'room', itemId: 'wall' }] }] }, initialPayRatio: 0.8, evidenceNote: '管理一栋墙砖原责任', sourceVersion: 'management-source', operatorId: 'actor', createdAt: '2026-09-01' }, managerName: '原负责人', eligible: true, reasons: [] }
}
export function feeConfigRead(version = 'fees-1'): PayrollAFeeConfigRead {
  const base = payrollUiConfig(version)
  return { context: base.context, scope: { ...base.scope, book: { bookPurpose: 'ordinary', managementBookId: null } }, baseVersion: version, options: base.options, crewDefaults: { crewId: 'crew', sourceVersion: 'crew-1', rentEnabled: { state: 'missing' }, rentUnitPrice: { state: 'missing' }, managementEnabled: { state: 'null', value: null }, managementUnitPrice: { state: 'value', value: 0 } }, fees: [], managementBooks: [feeManagementBook()], items: [{ itemId: 'wall', itemName: '同名分项', unit: '㎡', housingClassification: { state: 'missing' }, sourceVersion: 'items-1', scopes: [{ kind: 'project' }, { kind: 'cells', cells: [{ unitId: 'unit', roomId: 'room', itemId: 'wall' }] }] }, { itemId: 'floor', itemName: '同名分项', unit: '㎡', housingClassification: { state: 'value', value: 'floor-tile' }, sourceVersion: 'items-1', scopes: [{ kind: 'project' }] }, { itemId: 'sill', itemName: '窗台', unit: 'm', housingClassification: { state: 'value', value: 'other' }, sourceVersion: 'items-1', scopes: [{ kind: 'project' }] }], cellOptions: [{ unitId: 'unit', roomId: 'room', itemId: 'wall', locationLabel: '一栋 · 101 · 客厅 · 墙砖' }], responsibilityOptions: [{ ...feeManagementBook().revision!.scope.assignments[0]!, workerId: 'installer', crewId: 'crew', label: '一栋 · 原施工人 · 墙砖', eligible: true, reasons: [], sources: [] }], blockers: [], readonlyReasons: [], eligibility: { canSaveFees: true, canSaveManagementBook: true, canStartManagementDraft: true, feeReasons: [], managementReasons: [] }, history: [] }
}
export function feeDraft(): PayrollAFeeDraft {
  return { feeId: null, baseRevisionId: null, bookPurpose: 'ordinary', managementBookId: null, kind: 'housing', name: '房补', enabled: false, unitPrice: null, unit: '㎡', basis: { kind: 'completed-field-quantity', itemIds: [], scope: { kind: 'cells', cells: [] } }, effectiveMonth: '2026-09', adoptedDefault: null }
}
export function negativeDraft(): PayrollANegativeLineDraft {
  return { lineId: 'negative-line', baseRevisionId: 'negative-revision', label: '淋浴板未收尾代付', quantity: 30, unit: '套', unitPrice: -20, scope: feeManagementBook().revision!.scope, reason: '未收尾代付依据', evidenceNote: '经办确认', actualRef: null }
}
export function feesSnapshot(): PayrollAFeesSourceSnapshot {
  const fact = { ...payrollUiFact('1'), itemId: 'wall', itemName: '墙砖', fieldQty: 100 }
  return { schemaVersion: 1, configSourceVersion: 'fees-1', crewDefaults: feeConfigRead().crewDefaults, feeRevisions: [], management: null, managementOwnership: [], negativeLines: [], lines: [{ id: 'fee-line', kind: 'housing', feeId: 'housing', feeRevisionIds: ['housing-1'], name: '房补', buildingId: 'building', buildingName: '一栋', itemId: 'wall', itemName: '墙砖', unit: '㎡', quantity: 100, knownQuantity: 100, amount: feeAmount(130), components: [{ componentKey: 'housing-original', feeId: 'housing', feeRevisionId: 'housing-1', ownershipKey: fact.ownershipKey, managementOwnership: null, fact, quantity: 100, unitPrice: 1.3, amountFen: 13000 }], sources: [], blockers: [] }], totals: { workAmount: feeAmount(3600), subsidyAmount: feeAmount(130), managementAmount: feeAmount(0), negativeAmount: feeAmount(0), listAmount: feeAmount(3730), cumulativeAmount: feeAmount(3730), previouslyPaid: feeAmount(0), grossAmount: feeAmount(3730) } }
}
export function feeFormRead(): PayrollAFeesFormRead {
  const fees = feesSnapshot()
  return { ...payrollUiForm('draft'), draft: { ...payrollUiForm('draft').draft, book: { bookPurpose: 'ordinary', managementBookId: null } }, book: { bookPurpose: 'ordinary', managementBookId: null }, bookProof: { state: 'proven', book: { bookPurpose: 'ordinary', managementBookId: null }, sourceVersion: 'book-1' }, bookEligibility: { canSave: true, canCheck: true, canRelease: false, reasons: [] }, managementBooks: [feeManagementBook()], negativeLineDrafts: [], negativeLineRevisions: [], previousBookPayments: [], fees, totals: fees.totals, blockers: [] }
}
export function feeDocument(): PayrollAFeesFrozenDocument {
  return { ...payrollUiDocument(), book: { bookPurpose: 'ordinary', managementBookId: null }, fees: feesSnapshot(), workAmount: 3600, listAmount: 3730, cumulativeAmount: 3730, previouslyPaid: 0, grossAmount: 3730, actualAmount: 3730, previousPayments: [], previousBookPayments: [] }
}
