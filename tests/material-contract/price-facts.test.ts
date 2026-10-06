import type { MaterialContractCommandRequestDTO } from '~/lib/material-contract/command-contract'
import { describe, expect, it } from 'vitest'
import { buildContractPriceFacts, compareContractPrice, decodeContractPriceRead } from '~/lib/material-contract/price-facts'
import { createMaterialContractCommandTestInstance } from '../../server/utils/material-contract-command-test-instance'
import { publicReadMeta } from '../helpers/public-read-meta'

function fixture() {
  let next = 0
  const owner = createMaterialContractCommandTestInstance({ createId: () => `contract-${++next}`, createLineId: () => `line-${++next}`, projects: [{ id: 'p', name: '真实项目' }], suppliers: [{ id: 's', name: '真实分供方' }] })
  const actor = { workspaceId: 'price-workspace', actorId: 'price-owner', capabilities: ['material-contract:read', 'material-contract:write'] }
  const request: MaterialContractCommandRequestDTO = { workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-contract:write', commandId: 'prices-original', baseVersion: null, action: 'submit', attachments: {}, draft: { name: '原约定方管', projectId: 'p', supplierId: 's', content: '原文', signDate: '2026-10-04', amount: 18000, taxRate: 13, lineItems: [{ materialName: '方管', spec: '40×40×2', materialGrade: '304', unit: '吨', qty: 1, taxInclusiveUnitPrice: 18000, applicableTaxRate: null }] } }
  return { owner, actor, request }
}

describe('合同约定价同 owner 投影', () => {
  it('本行未知税点不借用头13%，原合同和协议明细都有真实身份；重复原命令不复制价', async () => {
    const f = fixture()
    const main = await f.owner.execute(f.request, f.actor)
    expect(await f.owner.execute(f.request, f.actor)).toEqual(main)
    await f.owner.execute({ ...f.request, commandId: 'price-supplement', draft: { ...f.request.draft, isSupplement: true, originalContractId: main.id, name: '后来协议', amount: 19, lineItems: [{ materialName: '方管', spec: '40×40×2', unit: '千克', qty: 1, taxInclusiveUnitPrice: 19, applicableTaxRate: 0 }] } }, f.actor)
    const rows = buildContractPriceFacts(f.owner.rows(), f.owner.facts())
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ contractId: main.id, parentContractId: null, applicableTaxRate: null, taxInclusiveUnitPrice: 18000, materialGrade: '304' })
    expect(rows[1]).toMatchObject({ parentContractId: main.id, applicableTaxRate: 0, taxInclusiveUnitPrice: 19, materialGrade: '' })
    const converted = compareContractPrice(rows[0]!, { unit: '千克', factor: 1000, basis: '原件及法定单位1吨=1000千克' })
    expect(converted).toMatchObject({ unit: '千克', quantity: 1000, unitPrice: 18 })
    expect(converted.quantity! * converted.unitPrice!).toBe(18000)
    expect(f.owner.form(main.id, f.actor).draft.lineItems?.[0]).toMatchObject({ qty: 1, unit: '吨', taxInclusiveUnitPrice: 18000, applicableTaxRate: null })
    const cold = createMaterialContractCommandTestInstance({ projects: [{ id: 'p', name: '真实项目' }], suppliers: [{ id: 's', name: '真实分供方' }] })
    cold.importState(f.owner.exportState())
    expect(buildContractPriceFacts(cold.rows(), cold.facts())).toEqual(rows)
  })

  it('完整空数据与草稿/作废不伪装有效价；关联撤权不泄露ID或姓名', async () => {
    const f = fixture()
    await f.owner.execute(f.request, f.actor)
    const rows = f.owner.rows()
    expect(buildContractPriceFacts(rows.map(row => ({ ...row, status: '草稿' })), f.owner.facts())).toEqual([])
    expect(buildContractPriceFacts(rows.map(row => ({ ...row, status: '已作废' })), f.owner.facts())).toEqual([])
    expect(buildContractPriceFacts(rows.map(row => ({ ...row, supplierReferenceState: 'forbidden', projectReferenceState: 'forbidden' })), f.owner.facts())[0]).toMatchObject({ supplierId: null, supplierName: null, projectId: null, projectName: null })
    expect(buildContractPriceFacts([], f.owner.facts())).toEqual([])
  })

  it('无可靠倍数保持原单位；拒绝零/负/无限倍数或空依据，未知与真实0不互换', async () => {
    const f = fixture()
    await f.owner.execute(f.request, f.actor)
    const row = buildContractPriceFacts(f.owner.rows(), f.owner.facts())[0]!
    for (const factor of [0, -1, Infinity, NaN])
      expect(() => compareContractPrice(row, { unit: '千克', factor, basis: '明确依据' })).toThrow('正倍数')
    expect(() => compareContractPrice(row, { unit: '千克', factor: 1000, basis: '' })).toThrow('依据')
    expect(() => compareContractPrice(row, { unit: '千克', factor: Number.MIN_VALUE, basis: '明确依据' })).toThrow('数值范围')
    expect(compareContractPrice({ ...row, quantity: null, taxInclusiveUnitPrice: null })).toMatchObject({ unit: '吨', quantity: null, unitPrice: null, basis: null })
    expect(compareContractPrice({ ...row, quantity: 0, taxInclusiveUnitPrice: 0 }, { unit: '千克', factor: 1000, basis: '明确依据' })).toMatchObject({ quantity: 0, unitPrice: 0 })
  })

  it('公开解码拒绝跨来源、同ID重复、伪造税点及缺身份来源证明', async () => {
    const f = fixture()
    await f.owner.execute(f.request, f.actor)
    const meta = publicReadMeta({ schemaVersion: 'material-contract-prices-v1', dataOrigin: 'real', asOf: '2026-10-04T00:00:00.000Z', sourceVersion: 'actual-price-owner-v1', capabilities: f.actor.capabilities, scope: { origin: 'real' }, requested: true })
    const read = { dataOrigin: 'real', items: buildContractPriceFacts(f.owner.rows(), f.owner.facts()), ...meta, meta }
    expect(decodeContractPriceRead(read, 'real').items[0]?.applicableTaxRate).toBeNull()
    expect(() => decodeContractPriceRead(read, 'demo')).toThrow('无效')
    expect(() => decodeContractPriceRead({ ...read, items: [...read.items, ...read.items] }, 'real')).toThrow('无效')
    expect(() => decodeContractPriceRead({ ...read, items: [{ ...read.items[0], applicableTaxRate: -1 }] }, 'real')).toThrow('无效')
    expect(() => decodeContractPriceRead({ ...read, meta: undefined }, 'real')).toThrow('无效')
  })
})
