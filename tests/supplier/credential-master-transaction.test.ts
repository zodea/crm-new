import { describe, expect, it } from 'vitest'
import { createSupplierCommandTestInstance } from '../../server/utils/supplier-command-test-instance'

const session = { workspaceId: 'atomic', actorId: 'reviewer', capabilities: ['supplier:write', 'supplier:list:read'] }

describe('证照与主档共同事务', () => {
  it('同次提交更新主档字段，重复税号失败不会留下证照确认事实', async () => {
    const instance = createSupplierCommandTestInstance()
    const create = (commandId: string, taxNo: string) => instance.execute({ action: 'save', commandId, requiredCapability: 'supplier:write', workspaceId: 'atomic', actorId: 'reviewer', baseVersion: null, attachments: {}, draft: { name: commandId, supplierCategory: '其他', contact: '测试联系人', taxNo } }, session)
    const first = await create('first', 'TAX-A')
    await create('second', 'TAX-B')
    instance.transactCredentialScope(first.id, (scope) => {
      scope.draft.taxNo = 'TAX-C'
      scope.aggregate.version++
      return { changed: true, value: null }
    })
    expect(instance.form(first.id, session).draft.taxNo).toBe('TAX-C')
    const version = instance.form(first.id, session).version
    expect(() => instance.transactCredentialScope(first.id, (scope) => {
      scope.draft.taxNo = 'TAX-B'
      scope.aggregate.version++
      scope.aggregate.review = { decision: 'qualified', reviewedAt: '2026-09-12T00:00:00Z', actorId: 'reviewer', note: '应整体拒绝' }
      return { changed: true, value: null }
    })).toThrow(/统一社会信用代码/)
    expect(instance.form(first.id, session)).toMatchObject({ version, draft: { taxNo: 'TAX-C' } })
    expect(instance.readCredentialScope(first.id).aggregate).toMatchObject({ version: 1, review: null })
  })
})
