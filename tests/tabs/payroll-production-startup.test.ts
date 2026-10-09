import { expect, it } from 'vitest'
import { readPayrollStartupDescriptors } from '../../app/lib/payroll/startup-recovery'

const actor = { workspaceId: 'formal-workspace', actorId: 'formal-owner' }
function fixture(bucket: string, scope: unknown[], targetId: string | null, action: string) {
  const entryKey = JSON.stringify(scope)
  const descriptor = { ...actor, family: 'payroll', commandId: 'original-payroll-command', targetId, action, scopeId: encodeURIComponent(entryKey) }
  const encoded = JSON.stringify({ [entryKey]: descriptor })
  const storage = { getItem: (key: string) => key === bucket ? encoded : null }
  return { storage, descriptor, entryKey }
}
it('按当前身份、真实原单和格式保刷新位置；别人的编号、另一目标、配置及模拟来源不能借用', () => {
  const f = fixture('payroll-c1-central-pending-v1', [actor.workspaceId, actor.actorId, 'real', 'C1', 'original-c1'], 'original-c1', 'release-c1')
  expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1?origin=real', actor, f.storage)).toEqual([{ descriptor: f.descriptor, storageKey: 'payroll-c1-central-pending-v1', entryKey: f.entryKey }])
  expect(readPayrollStartupDescriptors('/subcontract/payroll/form/other-c1', actor, f.storage)).toEqual([])
  expect(readPayrollStartupDescriptors('/subcontract/payroll/payments/other-c1', actor, f.storage)).toEqual([])
  expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1?origin=mock', actor, f.storage)).toEqual([])
  expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1', { ...actor, actorId: 'another-owner' }, f.storage)).toEqual([])
  expect(readPayrollStartupDescriptors('/subcontract/payroll/config?format=A', actor, f.storage)).toEqual([])
})
it('考勤本人日期、原计划、编号及新草稿保准确范围；无scope和坏存储整批停止', () => {
  const a = fixture('payroll-attendance-central-pending-v1', [actor.workspaceId, actor.actorId, 'real', 'attendance', 'project-one', 'worker-one', '2026-08-03'], null, 'upsert-attendance')
  expect(readPayrollStartupDescriptors('/subcontract/attendance?projectId=project-one&month=2026-08', actor, a.storage)).toHaveLength(1)
  expect(readPayrollStartupDescriptors('/subcontract/attendance?projectId=project-two&month=2026-08', actor, a.storage)).toEqual([])
  expect(readPayrollStartupDescriptors('/subcontract/attendance?projectId=project-one&month=2026-09', actor, a.storage)).toEqual([])
  const n = fixture('payroll-numbering-pending-v1', [actor.workspaceId, actor.actorId, 'project-one', 'original-c1'], 'original-c1', 'issue')
  expect(readPayrollStartupDescriptors('/subcontract/payroll/issue/original-c1?projectId=project-one', actor, n.storage)).toHaveLength(1)
  expect(readPayrollStartupDescriptors('/subcontract/payroll/form/original-c1', actor, n.storage)).toEqual([])
  const draft = fixture('payroll-c2-central-pending-v1', [actor.workspaceId, actor.actorId, 'real', 'C2', 'draft-one'], null, 'save-c2-draft')
  expect(readPayrollStartupDescriptors('/subcontract/payroll/new?format=C2&draftKey=draft-one', actor, draft.storage)).toHaveLength(1)
  expect(readPayrollStartupDescriptors('/subcontract/payroll/new?format=C2&draftKey=other-draft', actor, draft.storage)).toEqual([])
  expect(() => readPayrollStartupDescriptors('/subcontract/payroll', actor, { getItem: () => '{broken' })).toThrow('损坏')
  const bad = { ...draft.descriptor, scopeId: 'unproved-key' }
  expect(() => readPayrollStartupDescriptors('/subcontract/payroll/new?format=C2', actor, { getItem: key => key.includes('-c2-') ? JSON.stringify({ [draft.entryKey]: bad }) : null })).toThrow('稳定上下文')
})
