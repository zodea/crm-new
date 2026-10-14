import { expect, it } from 'vitest'
import { decodePayrollAFeeConfigRead, encodePayrollAFeesWire, parsePayrollAFeesCommand } from '../../app/lib/payroll/central-a-fees-codec'
import { createPayrollRepository } from '../../app/lib/payroll/central-repository'
import captured from '../fixtures/payroll/fees-config-captured.json'
import { createPayrollAFeesFixture } from '../helpers/payroll-a-fees-fixture'

it('真实名册工资事实只投影 A 候选合同，经 HTTP wire 可读取费用配置', async () => {
  const f = await createPayrollAFeesFixture()
  try {
    for (const worker of f.source.workers)
      Object.assign(worker, { workerId: worker.id, currentProjectId: 'p', dailyWage: 0, dailyWageState: 'value', sourceVersion: 'real-worker-fact' })
    Object.assign(f.source.projects[0]!, { internalSourceVersion: 'project-read-version' })
    const read = await f.feeConfig()
    const repository = createPayrollRepository(async () => encodePayrollAFeesWire(read))
    await expect(repository.aFeeConfig({ origin: 'real' }, read.scope)).resolves.toMatchObject({ options: { workers: expect.arrayContaining([expect.objectContaining({ id: 'w', name: '负责人' })]) } })
    expect(Object.keys(read.options.workers[0]!).sort()).toEqual(['id', 'name', 'crewId', 'eligible', 'reasons', 'source'].sort())
    expect(read.options.projects).toEqual([{ id: 'p', name: '工资项目', code: 'P' }])
  }
  finally { await f.close() }
})

it('浏览器真实 HTTP 响应保留中文原房间迁入身份，读取与管理范围提交都可用', () => {
  const scope = { ...captured.scope, book: { bookPurpose: 'ordinary' as const, managementBookId: null } }
  expect(() => decodePayrollAFeeConfigRead(captured, { origin: 'real' }, scope)).not.toThrow()
  const read = decodePayrollAFeeConfigRead(captured, { origin: 'real' }, scope)
  expect(read.cellOptions.some(c => c.roomId.endsWith('%E4%B8%89'))).toBe(true)
  const command = { commandId: 'captured-command', workspaceId: read.context.workspaceId, actorId: read.context.actorId, origin: 'real', requiredCapability: 'payroll:write', sourceVersion: read.context.sourceVersion, projectId: scope.projectId, statementId: null, draftKey: null, configScope: scope, book: scope.book, action: { kind: 'save-a-management-book', baseVersion: read.baseVersion, management: { managementBookId: null, baseRevisionId: null, managerWorkerId: scope.leaderWorkerId, effectiveMonth: scope.month, managementMode: 'crew-managed', scope: { assignments: read.responsibilityOptions.map(r => ({ assignmentId: r.assignmentId, scopeIds: r.scopeIds, cells: r.cells })) }, initialPayRatio: 0.8, evidenceNote: '保留真实中文房间责任' } } }
  expect(() => parsePayrollAFeesCommand(encodePayrollAFeesWire(command))).not.toThrow()
})

it.each(['%XX', '%E4%B8', '%e4%b8%89', 'https://outside.invalid/%E4%B8%89'])('真实响应中的非标准迁入编码仍被拒绝：%s', (suffix) => {
  const raw = structuredClone(captured)
  raw.cellOptions[1]!.roomId = suffix.startsWith('https:') ? suffix : `core-quantity_projects-f0ee60ca6ba460c3cc78ad09:rooms:room-${suffix}`
  expect(() => decodePayrollAFeeConfigRead(raw, { origin: 'real' }, { ...raw.scope, book: { bookPurpose: 'ordinary', managementBookId: null } })).toThrow('工资费用提交或读取内容无效')
})

it.each((['other-namespace:rooms:room-%E4%B8%89', 'core-quantity_projects-f0ee60ca6ba460c3cc78ad09:items:room-%E4%B8%89']).map(input => ({ input })))('编码相同也不接受伪造迁入命名空间或跨表身份：输入案例 %#', ({ input: roomId }) => {
  const raw = structuredClone(captured)
  raw.cellOptions[1]!.roomId = roomId
  expect(() => decodePayrollAFeeConfigRead(raw, { origin: 'real' }, { ...raw.scope, book: { bookPurpose: 'ordinary', managementBookId: null } })).toThrow('工资费用提交或读取内容无效')
})
