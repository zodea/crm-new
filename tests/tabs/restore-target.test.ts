import type { TabDescriptor } from '~/lib/tabs/restoration-contract'
import type { DomainRepositories } from '~/plugins/repositories'
import { describe, expect, it, vi } from 'vitest'
import { createTabRestoreValidator, inspectRestorableTabPath } from '~/lib/tabs/restore-target'

function descriptor(fullPath: string): TabDescriptor {
  return { key: fullPath.split('?')[0]!, title: '旧名称', fullPath, origin: 'real', targetVersion: 1, sourceVersion: 'old-version', updatedAt: 1, closable: true }
}

it.each(['/', '/schedule'])('排程返回上下文在%s冷刷时完整保留', (path) => {
  const fullPath = `${path}?project=p&origin=real&group=g&task=t&stage=s&item=i&buildings=b&building=b&month=2026-08&view=crew&trade=masonry&assignee=crew%3Ac`
  expect(inspectRestorableTabPath(fullPath)?.fullPath).toBe(fullPath)
})

const capabilities = ['project:list:read', 'customer:list:read', 'supplier:list:read', 'crew:list:read', 'worker:list:read', 'project-supplier:read', 'material-contract:read', 'construction-contract:read', 'subcontract-contract:read', 'owner-document:read', 'subcontract-document:read', 'auxiliary-contract:read', 'other-settlement:read', 'receipt:read', 'demo:read']
const ref = (entity: string, id = 'record-1') => ({ state: 'resolved', entity, id, label: '当前名称', no: null })
const base = { dataOrigin: 'real', capabilities, sourceVersion: 'current-version' }
const CASES = [
  { path: '/project/record-1?origin=real', repository: 'projectList', method: 'get', data: { ...base, item: { dataOrigin: 'real', project: ref('project') } } },
  ...['customer', 'supplier'].map(entity => ({ path: `/base/${entity}/record-1?origin=real`, repository: `${entity}Read`, method: 'get', data: { ...base, [entity]: { id: 'record-1', name: '当前名称' } } })),
  ...['crew', 'worker'].map(entity => ({ path: `/base/${entity}/record-1?origin=real`, repository: 'crewWorkerRead', method: entity === 'crew' ? 'getCrew' : 'getWorker', data: { ...base, [entity]: { id: 'record-1', name: '当前名称' } } })),
  ...[['material', '材采'], ['construction', '施工'], ['subcontract', '分包']].map(([kind, label]) => ({ path: `/contract/record-1?origin=real&contractKind=${kind}`, repository: `${kind}ContractRead`, method: 'get', data: { ...base, contract: { id: 'record-1', name: '当前名称', kind: label } } })),
  { path: '/project/record-1/supplier/supplier-1?origin=real&tab=payment', repository: 'projectSupplierRead', method: 'get', data: { ...base, project: ref('project'), supplier: ref('supplier', 'supplier-1') } },
  { path: '/finance/receipt/record-1?origin=real', repository: 'receipts', method: 'detail', data: { ...base, record: { id: 'record-1', dataOrigin: 'real', draft: { no: '当前名称' } } } },
  { path: '/owner/change/record-1?origin=real', repository: 'ownerCommercialDocumentRead', method: 'get', data: { ...base, document: { id: 'record-1', name: '当前名称', kind: 'owner_change' } } },
  { path: '/subcontract/settlement/record-1?origin=real', repository: 'ownerCommercialDocumentRead', method: 'get', data: { ...base, document: { id: 'record-1', name: '当前名称', kind: 'sub_settlement' } } },
  { path: '/contract/other-expense/record-1?origin=real', repository: 'auxiliaryContracts', method: 'detail', data: { ...base, contract: { id: 'record-1', dataOrigin: 'real', kind: 'other_expense', version: 'current-version', draft: { name: '当前名称' } } } },
  { path: '/contract/other-settlement/record-1?origin=real', repository: 'otherSettlements', method: 'detail', data: { ...base, settlement: { id: 'record-1', dataOrigin: 'real', version: 'current-version', draft: { name: '当前名称' } } } },
]

function validator(repository: string, method: string, read: ReturnType<typeof vi.fn>, permissions = capabilities) {
  return createTabRestoreValidator({ repositories: { [repository]: { [method]: read } } as unknown as DomainRepositories, includeDemo: () => true, capabilities: () => permissions })
}

describe('页签恢复目标白名单', () => {
  it('保留列表筛选与来源，丢弃未登记的 query', () => {
    expect(inspectRestorableTabPath('/project?status=active&status=closed&page=2&token=secret')).toEqual({
      fullPath: '/project?status=active&status=closed&page=2',
      origin: null,
    })
    expect(inspectRestorableTabPath('/base/customer/customer-1?origin=demo&tab=receipts')).toEqual({
      fullPath: '/base/customer/customer-1?origin=demo&tab=receipts',
      origin: 'demo',
    })
  })

  it.each(['/project/form/new', '/base/customer/new', '/finance/invoice/invoice-1', '/finance/invoice', '/import/mapping/project', '/dev/kit-ui', '/settings/data-migration', '/settings/ocr', '/subcontract/quantity/stages?project=p&origin=real', '//evil.example/project', '/project/%2e%2e/base/customer', '/project/id?origin=other'])('排除写态或非法目标 %s', (path) => {
    expect(inspectRestorableTabPath(path)).toBeNull()
  })

  it('拒绝单值来源参数的歧义，避免验证首值后页面读取另一个值', () => {
    expect(inspectRestorableTabPath('/contract/other-settlement/record-1?contractId=a&contractId=b')).toBeNull()
  })

  it('显式登记缺只读接线的稳定详情，而非借编辑路由兜底', () => {
    expect(inspectRestorableTabPath('/finance/payment/pay-1/detail')).toEqual({ fullPath: '/finance/payment/pay-1/detail', origin: 'real' })
    expect(inspectRestorableTabPath('/finance/payment/pay-1')).toBeNull()
    expect(inspectRestorableTabPath('/subcontract/daywork')).toEqual({ fullPath: '/subcontract/daywork', origin: null })
    expect(inspectRestorableTabPath('/subcontract/attendance')).toEqual({ fullPath: '/subcontract/attendance', origin: null })
  })

  it.each([
    '/base/supplier?credentialStatus=expired&columnFilters=%7B%22name%22%3A%22abc%22%7D',
    '/contract/subcontract?subKind=labour&status=active&status=closed',
    '/owner/acceptance?documentType=warranty&contract=contract-1',
    '/subcontract/payroll?project=project-1&crew=crew-1&month=2026-09',
    '/schedule?origin=real&project=project-1&from=home&group=group-1&task=task-1',
    '/subcontract/quantity?from=schedule&origin=demo&project=p&group=g&task=t&stage=s&item=i&building=b&buildings=b%2Cc&groupName=G&taskName=T&itemName=I&planStart=2026-09-01&planFinish=2026-09-30',
    '/contract/boq?project=p&contract=c&tab=changes&focus=f',
  ])('保留实际页面正在读取的筛选及来源参数 %s', (path) => {
    expect(inspectRestorableTabPath(path)?.fullPath).toBe(path)
  })
})

describe('页签恢复重新读取当前权威目标', () => {
  it.each(CASES)('$path 使用领域读取及当前版本，不把域版本变化当删除', async ({ path, repository, method, data }) => {
    const read = vi.fn().mockResolvedValue(data)
    const result = await validator(repository, method, read)(descriptor(path))
    expect(result).toMatchObject({ state: 'resolved', sourceVersion: 'current-version' })
    if (result.state === 'resolved')
      expect(result.title).toContain('当前名称')
    expect(read).toHaveBeenCalledOnce()
  })

  it('当前权限不足时不请求记录，也不泄露旧标题', async () => {
    const read = vi.fn()
    const result = await validator('projectList', 'get', read, [])(descriptor('/project/record-1?origin=real'))
    expect(result).toMatchObject({ state: 'forbidden' })
    expect(JSON.stringify(result)).not.toContain('旧名称')
    expect(read).not.toHaveBeenCalled()
  })

  it('列表只验证当前能力且不读取未活动的实体，未知来源版本保持 null', async () => {
    const read = vi.fn()
    const tab = { ...descriptor('/project?status=active'), origin: null }
    expect(await validator('projectList', 'get', read)(tab)).toEqual({ state: 'resolved', title: '项目列表', fullPath: tab.fullPath, sourceVersion: null })
    expect(await validator('projectList', 'get', read, [])(tab)).toMatchObject({ state: 'forbidden' })
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['forbidden', 'not-found', 'relationship-mismatch', 'stale-source'])('保留后台失败语义 %s', async (code) => {
    const read = vi.fn().mockRejectedValue({ problem: { code } })
    expect(await validator('projectList', 'get', read)(descriptor('/project/record-1?origin=real'))).toMatchObject({ state: code === 'relationship-mismatch' ? 'mismatch' : code === 'stale-source' ? 'stale' : code })
  })

  it('不接受错误来源、稳定身份或合同kind', async () => {
    for (const data of [
      { ...base, dataOrigin: 'demo', contract: { id: 'record-1', kind: '施工', name: '泄露' } },
      { ...base, contract: { id: 'another', kind: '施工', name: '泄露' } },
      { ...base, contract: { id: 'record-1', kind: '分包', name: '泄露' } },
    ]) {
      const result = await validator('constructionContractRead', 'get', vi.fn().mockResolvedValue(data))(descriptor('/contract/record-1?origin=real&contractKind=construction'))
      expect(result).toMatchObject({ state: 'mismatch' })
      expect(JSON.stringify(result)).not.toContain('泄露')
    }
  })

  it('缺只读入口不借本地记录或写态恢复', async () => {
    expect(await validator('projectList', 'get', vi.fn())(descriptor('/finance/payment/pay-1/detail'))).toMatchObject({ state: 'not-connected' })
    expect(await validator('projectList', 'get', vi.fn())(descriptor('/contract/record-1'))).toMatchObject({ state: 'not-connected' })
  })

  it.each(['/project/target-cost/record-1', '/schedule/record-1'])('只读稳定详情 %s 没有目标读取入口时保留明确原因', async (path) => {
    expect(inspectRestorableTabPath(path)).not.toBeNull()
    expect(await validator('projectList', 'get', vi.fn())(descriptor(path))).toMatchObject({ state: 'not-connected' })
  })

  it('后台读取期间权限或演示开关改变时不应用已失权结果', async () => {
    for (const revoke of ['capability', 'demo']) {
      let finish!: (value: unknown) => void
      let permissions = capabilities
      let includeDemo = true
      const read = vi.fn(() => new Promise(resolve => finish = resolve))
      const validate = createTabRestoreValidator({ repositories: { projectList: { get: read } } as unknown as DomainRepositories, capabilities: () => permissions, includeDemo: () => includeDemo })
      const pending = validate({ ...descriptor('/project/record-1?origin=demo'), origin: 'demo' })
      if (revoke === 'capability')
        permissions = []
      else
        includeDemo = false
      finish({ ...CASES[0]!.data, item: { dataOrigin: 'demo', project: ref('project') } })
      expect(await pending).toMatchObject({ state: 'forbidden' })
    }
  })

  it('取消后的迟到读取不返回可应用结果', async () => {
    let finish!: (value: unknown) => void
    const read = vi.fn(() => new Promise(resolve => finish = resolve))
    const controller = new AbortController()
    const pending = validator('projectList', 'get', read)(descriptor('/project/record-1?origin=real'), controller.signal)
    controller.abort()
    finish(CASES[0]!.data)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })

  it.each([['supplements', 'supplement'], ['changes', 'change'], ['settlements', 'settlement'], ['acceptance', 'acceptance']])('施工合同 %s 内聚焦按页面规则验证事实', async (tab, scope) => {
    const read = vi.fn().mockResolvedValue({ ...base, contract: { id: 'record-1', name: '当前名称', kind: '施工' } })
    expect(await validator('constructionContractRead', 'get', read)(descriptor(`/contract/record-1?origin=real&contractKind=construction&tab=${tab}&focus=fact-1`))).toMatchObject({ state: 'resolved' })
    expect(read).toHaveBeenCalledWith(expect.objectContaining({ focus: expect.objectContaining({ id: 'fact-1', scope }) }))
  })

  it('分包合同仅在事实分区读取 focus，施工验收无效分组沿用页面忽略规则', async () => {
    const subcontract = vi.fn().mockResolvedValue({ ...base, contract: { id: 'record-1', name: '当前名称', kind: '分包' } })
    expect(await validator('subcontractContractRead', 'get', subcontract)(descriptor('/contract/record-1?origin=real&contractKind=subcontract&tab=info&focus=old-fact'))).toMatchObject({ state: 'resolved' })
    expect(subcontract).toHaveBeenCalledWith(expect.objectContaining({ focusId: null }))
    const construction = vi.fn().mockResolvedValue({ ...base, contract: { id: 'record-1', name: '当前名称', kind: '施工' } })
    expect(await validator('constructionContractRead', 'get', construction)(descriptor('/contract/record-1?origin=real&contractKind=construction&tab=acceptance&focus=fact-1&focusView=obsolete'))).toMatchObject({ state: 'resolved' })
    expect(construction).toHaveBeenCalledWith(expect.objectContaining({ focus: { id: 'fact-1', scope: 'acceptance', view: null } }))
  })

  it('其他支出结算保留并核对来源合同，丢弃抽屉状态', async () => {
    const path = '/contract/other-settlement/record-1?origin=real&contractId=contract-1&fact=fact-1&sourceTrail=old'
    const data = { ...base, settlement: { id: 'record-1', dataOrigin: 'real', version: 'current-version', draft: { name: '当前名称', contractId: 'contract-1' } } }
    const read = vi.fn().mockResolvedValue(data)
    expect(await validator('otherSettlements', 'detail', read)(descriptor(path))).toMatchObject({ state: 'resolved', fullPath: '/contract/other-settlement/record-1?origin=real&contractId=contract-1' })
    expect(read).toHaveBeenCalledWith('record-1', expect.objectContaining({ contractId: 'contract-1' }))
    read.mockResolvedValue({ ...data, settlement: { ...data.settlement, draft: { ...data.settlement.draft, contractId: 'another' } } })
    expect(await validator('otherSettlements', 'detail', read)(descriptor(path))).toMatchObject({ state: 'mismatch' })
  })

  it('带中央来源的排程重新核对项目，并保留排程入口，不转到同名本地项目', async () => {
    const path = '/schedule?origin=real&project=record-1&from=home&group=group-1&task=task-1'
    const read = vi.fn().mockResolvedValue(CASES[0]!.data)
    expect(await validator('projectList', 'get', read)(descriptor(path))).toMatchObject({ state: 'resolved', fullPath: path, title: expect.stringContaining('当前名称'), sourceVersion: 'current-version' })
    expect(read).toHaveBeenCalledWith({ id: 'record-1', origin: 'real', includeDemo: true })
    read.mockResolvedValue({ ...CASES[0]!.data, item: { dataOrigin: 'demo', project: ref('project') } })
    expect(await validator('projectList', 'get', read)(descriptor(path))).toMatchObject({ state: 'mismatch' })
  })
})

describe('页签恢复班组与工人的关联事实', () => {
  function factValidator(kind: string, ownerKind = 'worker', overrides: Record<string, unknown> = {}) {
    const fact = ref(kind === 'assignment' ? 'quantity-unit' : kind === 'wage' ? 'wage-statement' : 'subcontract-document')
    const project = ref('project', 'project-1')
    const identity = vi.fn().mockResolvedValue({ kind, id: 'record-1', dataOrigin: 'real', projectId: 'project-1', owners: [{ kind: ownerKind, id: 'owner-1' }], ...overrides })
    const read = vi.fn().mockResolvedValue({ ...base, [ownerKind]: { id: 'owner-1', name: '归属名称' }, assignments: [{ unit: fact, project }], wageStatements: [{ statement: fact, project }], penalties: [{ penalty: fact, project }] })
    const validate = createTabRestoreValidator({ repositories: { crewWorkerRead: { getRelationFactIdentity: identity, [ownerKind === 'worker' ? 'getWorker' : 'getCrew']: read } } as unknown as DomainRepositories, includeDemo: () => true, capabilities: () => capabilities })
    const path = kind === 'assignment' ? '/subcontract/quantity/project-1/record-1' : kind === 'wage' ? '/subcontract/payroll/record-1' : '/project/penalty/record-1'
    return { identity, read, validate, path: `${path}?origin=real&ownerKind=${ownerKind}&ownerId=owner-1` }
  }

  it.each([['assignment', 'worker'], ['wage', 'worker'], ['penalty', 'worker'], ['penalty', 'crew']])('%s / %s 核对事实身份、归属与现时标题版本', async (kind, ownerKind) => {
    const { identity, read, validate, path } = factValidator(kind, ownerKind)
    expect(await validate(descriptor(path))).toMatchObject({ state: 'resolved', fullPath: path, title: '当前名称', sourceVersion: 'current-version' })
    expect(identity).toHaveBeenCalledWith({ kind, id: 'record-1', origin: 'real', includeDemo: true })
    expect(read).toHaveBeenCalledWith({ id: 'owner-1', origin: 'real', includeDemo: true })
  })

  it.each([{ dataOrigin: 'demo' }, { id: 'another' }, { kind: 'penalty' }, { projectId: 'another' }, { owners: [] }])('身份、来源、类别、项目或归属不符时不读归属对象 %j', async (override) => {
    const { read, validate, path } = factValidator('assignment', 'worker', override)
    expect(await validate(descriptor(path))).toMatchObject({ state: 'mismatch' })
    expect(read).not.toHaveBeenCalled()
  })

  it('来源对象已有但未提供该事实时，不把别的记录作为恢复目标', async () => {
    const { read, validate, path } = factValidator('wage')
    read.mockResolvedValue({ ...base, worker: { id: 'owner-1', name: '名称' }, wageStatements: [] })
    expect(await validate(descriptor(path))).toMatchObject({ state: 'not-found' })
    read.mockResolvedValue({ ...base, worker: { id: 'another', name: '名称' }, wageStatements: [{ statement: ref('wage-statement') }] })
    expect(await validate(descriptor(path))).toMatchObject({ state: 'mismatch' })
  })

  it.each(['assignment', 'wage'])('班组 %s 无具体只读明细集合时明确尚未接线', async (kind) => {
    const { validate, path } = factValidator(kind, 'crew')
    expect(await validate(descriptor(path))).toMatchObject({ state: 'not-connected' })
  })

  it.each(['ownerKind=worker', 'ownerId=owner-1', 'ownerKind=other&ownerId=owner-1'])('残缺归属标记不回退另一读取来源 %s', async (query) => {
    const read = vi.fn()
    expect(await validator('ownerCommercialDocumentRead', 'get', read)(descriptor(`/project/penalty/record-1?origin=real&${query}`))).toMatchObject({ state: 'mismatch' })
    expect(read).not.toHaveBeenCalled()
  })

  it('事实身份读取后被取消，不再读取归属对象也不返回可应用结果', async () => {
    const { identity, read, validate, path } = factValidator('wage')
    let finish!: (value: unknown) => void
    identity.mockImplementation(() => new Promise(resolve => finish = resolve))
    const controller = new AbortController()
    const pending = validate(descriptor(path), controller.signal)
    controller.abort()
    finish({ kind: 'wage', id: 'record-1', dataOrigin: 'real', owners: [{ kind: 'worker', id: 'owner-1' }], projectId: 'project-1' })
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(read).not.toHaveBeenCalled()
  })
})
