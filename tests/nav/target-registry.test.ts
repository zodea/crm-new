import type { NavigationIntentDTO } from '~/types/read-model'
import { describe, expect, it } from 'vitest'
import {
  registeredTargetKeys,
  resolveNavigationTarget,
} from '~/lib/nav/target-registry'

function projectIntent(overrides: Partial<NavigationIntentDTO> = {}): NavigationIntentDTO {
  return {
    kind: 'entity-detail',
    subject: {
      state: 'resolved',
      entity: 'project',
      id: 'project/central-001',
      label: '中央项目一号',
      no: 'PRJ-001',
    },
    variant: 'detail',
    view: null,
    filters: { dataOrigin: 'real' },
    ...overrides,
  } as NavigationIntentDTO
}

describe('唯一 Target Registry', () => {
  it('项目材采聚合入口只按稳定项目 ID 与来源解析真实列表', () => {
    const intent: NavigationIntentDTO = {
      kind: 'entity-list',
      entity: 'contract',
      variant: 'material',
      view: null,
      filters: { projectId: 'project/central-001', dataOrigin: 'demo' },
    }

    expect(resolveNavigationTarget(intent, {
      returnTo: '/project/project%2Fcentral-001?origin=demo&returnTo=%2Fproject%3Fnav%3Dorigin_319%23project-row-demo%253Aproject%252Fcentral-001&returnContext=origin_319',
    })).toEqual({
      state: 'resolved',
      label: '材料采购合同',
      to: '/contract/material?projectId=project%2Fcentral-001&origin=demo&returnTo=%2Fproject%2Fproject%252Fcentral-001%3Forigin%3Ddemo%26returnTo%3D%252Fproject%253Fnav%253Dorigin_319%2523project-row-demo%25253Aproject%25252Fcentral-001%26returnContext%3Dorigin_319',
    })

    expect(resolveNavigationTarget({
      ...intent,
      filters: { projectId: 'project-1', dataOrigin: 'real' },
    }, { returnTo: '/project/project-1' })).toEqual({
      state: 'resolved',
      label: '材料采购合同',
      to: '/contract/material?projectId=project-1&origin=real&returnTo=%2Fproject%2Fproject-1%3Forigin%3Dreal',
    })
  })

  it('材采聚合入口缺少项目身份、来源或使用未知 variant 时不猜列表', () => {
    const intent = (filters: Record<string, string | null>, variant = 'material'): NavigationIntentDTO => ({
      kind: 'entity-list',
      entity: 'contract',
      variant,
      view: null,
      filters,
    })

    expect(resolveNavigationTarget(intent({ dataOrigin: 'real' }))).toMatchObject({ state: 'error' })
    expect(resolveNavigationTarget(intent({ projectId: 'project-1' }))).toMatchObject({ state: 'error' })
    expect(resolveNavigationTarget(intent({ projectId: 'project-1', dataOrigin: 'real' }, 'construction')))
      .toMatchObject({ state: 'unverified-target' })
  })

  it('材料合同进入分供方事实页签时保留受限合同来源', () => {
    const listReturnTo = '/contract/material?projectId=project-1&origin=demo&nav=origin_319_contract#material-contract-row-demo%3Acontract-318'
    const returnTo = `/contract/contract-318?origin=demo&contractKind=material&tab=invoices&returnTo=${encodeURIComponent(listReturnTo)}`
    expect(resolveNavigationTarget({
      kind: 'entity-subview',
      subject: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '分供方一', no: null },
      variant: 'detail',
      view: 'invoices',
      filters: { dataOrigin: 'demo' },
    }, { returnTo })).toEqual({
      state: 'resolved',
      label: '分供方一',
      to: `/base/supplier/supplier-1?origin=demo&tab=invoices&returnTo=${encodeURIComponent(returnTo)}`,
    })
  })

  it('项目与分供方目标拒绝跨来源 returnTo，而不是保留错配链', () => {
    const projectList = resolveNavigationTarget({
      kind: 'entity-list',
      entity: 'contract',
      variant: 'material',
      view: null,
      filters: { projectId: 'project-1', dataOrigin: 'real' },
    }, { returnTo: '/project/project-1?origin=demo' })
    expect(projectList).toEqual({
      state: 'resolved',
      label: '材料采购合同',
      to: '/contract/material?projectId=project-1&origin=real',
    })

    const listReturnTo = '/contract/material?origin=demo&nav=origin_319_contract#material-contract-row-demo%3Acontract-1'
    const contractReturnTo = `/contract/contract-1?origin=demo&contractKind=material&returnTo=${encodeURIComponent(listReturnTo)}`
    const supplier = resolveNavigationTarget({
      kind: 'entity-subview',
      subject: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '分供方一', no: null },
      variant: 'detail',
      view: 'contracts',
      filters: { dataOrigin: 'real' },
    }, { returnTo: contractReturnTo })
    expect(supplier).toEqual({ state: 'resolved', label: '分供方一', to: '/base/supplier/supplier-1?origin=real&tab=contracts' })
  })

  it('材料采购合同详情保留显式数据来源', () => {
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-318', label: '材料合同', no: 'HT-318' },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo', contractKind: '材采' },
    })).toEqual({ state: 'resolved', label: '材料合同', to: '/contract/contract-318?origin=demo&contractKind=material' })
  })

  it('未声明材采类型的合同意图继续沿用原详情，避免改写施工与分包链路', () => {
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-old', label: '既有合同', no: null },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo' },
    })).toEqual({ state: 'resolved', label: '既有合同', to: '/contract/contract-old' })
  })

  it('分供方事实使用稳定 ID 解析项目分供方视图与付款申请详情', () => {
    expect(resolveNavigationTarget({
      kind: 'entity-subview',
      subject: { state: 'resolved', entity: 'project', id: 'project-1', label: '项目一', no: null },
      variant: 'supplier-workbench',
      view: 'overview',
      filters: { supplierId: 'supplier-1', dataOrigin: 'demo' },
    })).toEqual({ state: 'resolved', label: '项目一', to: '/project/project-1/supplier/supplier-1?origin=demo&tab=overview' })

    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'payment-application', id: 'payment-1', label: 'FK-001', no: 'FK-001' },
      variant: 'detail',
      view: null,
      filters: {},
    })).toEqual({ state: 'resolved', label: 'FK-001', to: '/finance/payment/payment-1/detail' })
  })

  it.each([
    ['contract', 'detail', '/contract/source-1'],
    ['payment-application', 'detail', '/finance/payment/source-1/detail'],
  ] as const)('项目分供方来源记录 %s/%s 消费双父 ID 与受限返回页签', (entity, variant, path) => {
    const returnTo = '/project/project-1/supplier/supplier-1?origin=demo&tab=settlement'
    const intent: NavigationIntentDTO = {
      kind: 'source-record',
      subject: { state: 'resolved', entity, id: 'source-1', label: '来源单', no: 'NO-1' },
      variant,
      view: null,
      filters: { dataOrigin: 'demo' },
    }

    expect(resolveNavigationTarget(intent, { returnTo })).toEqual({
      state: 'resolved',
      label: '来源单',
      to: `${path}?projectId=project-1&supplierId=supplier-1&origin=demo&returnTo=${encodeURIComponent(returnTo)}`,
    })
  })

  it.each([
    ['invoice', 'detail'],
    ['payment-record', 'detail'],
    ['settlement', 'subcontract-settlement'],
    ['settlement', 'material-settlement'],
    ['settlement', 'other-settlement'],
  ] as const)('编辑或未验证的来源记录 %s/%s 不生成假链接', (entity, variant) => {
    expect(resolveNavigationTarget({
      kind: 'source-record',
      subject: { state: 'resolved', entity, id: 'source-1', label: '来源单', no: 'NO-1' },
      variant,
      view: null,
      filters: { dataOrigin: 'demo' },
    }, { returnTo: '/project/project-1/supplier/supplier-1?origin=demo&tab=settlement' })).toEqual({
      state: 'unverified-target',
      label: '来源单',
      message: '目标待核验',
    })
  })

  it('来源记录只在演示来源与返回来源一致时解析', () => {
    const intent: NavigationIntentDTO = {
      kind: 'source-record',
      subject: { state: 'resolved', entity: 'contract', id: 'source-1', label: '来源单', no: 'NO-1' },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'real' },
    }
    expect(resolveNavigationTarget(intent, { returnTo: '/project/project-1/supplier/supplier-1?tab=contract' }))
      .toMatchObject({ state: 'unverified-target' })
    expect(resolveNavigationTarget({ ...intent, filters: { dataOrigin: 'demo' } }, {
      returnTo: '/project/project-1/supplier/supplier-1?tab=contract',
    })).toMatchObject({ state: 'unverified-target' })
  })

  it('收款详情要求稳定来源与客户上下文', () => {
    const subject = {
      state: 'resolved' as const,
      entity: 'receipt' as const,
      id: 'receipt-1',
      label: 'SK-001',
      no: 'SK-001',
    }
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject,
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo', customerId: 'customer-1' },
    })).toEqual({
      state: 'resolved',
      label: 'SK-001',
      to: '/finance/receipt/receipt-1?origin=demo&customerId=customer-1',
    })
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject,
      variant: 'detail',
      view: null,
      filters: {},
    })).toMatchObject({ state: 'error' })
  })

  it('收款详情只透传已校验的客户列表返回上下文', () => {
    const returnTo = '/base/customer?search=%E5%90%88%E5%92%8C&nav=origin_314#customer-row-demo%3Acustomer_demo_001'
    const intent: NavigationIntentDTO = {
      kind: 'entity-detail',
      subject: {
        state: 'resolved',
        entity: 'receipt',
        id: 'receipt-1',
        label: 'SK-001',
        no: 'SK-001',
      },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo', customerId: 'customer-1' },
    }

    expect(resolveNavigationTarget(intent, {
      returnTo,
      returnContextId: 'origin_314',
    })).toMatchObject({
      state: 'resolved',
      to: `/finance/receipt/receipt-1?origin=demo&customerId=customer-1&returnTo=${encodeURIComponent(returnTo)}&returnContext=origin_314`,
    })
  })

  it('只用语义意图和稳定 ID 解析项目 canonical 只读详情', () => {
    const intent = projectIntent()

    expect(JSON.stringify(intent)).not.toContain('/project')
    expect(resolveNavigationTarget(intent)).toEqual({
      state: 'resolved',
      label: '中央项目一号',
      to: '/project/project%2Fcentral-001?origin=real',
    })
    expect(registeredTargetKeys()).toContain('project:detail')
  })

  it('canonical variant 未登记时保持 unverified-target，不猜路由', () => {
    expect(resolveNavigationTarget(projectIntent({ variant: 'summary' }))).toEqual({
      state: 'unverified-target',
      label: '中央项目一号',
      message: '目标待核验',
    })
  })

  it.each([
    ['missing-id', 'missing', '未记录稳定身份'],
    ['forbidden', 'forbidden', '无查看权限'],
    ['missing-route', 'not-connected', '详情待接入'],
    ['not-connected', 'not-connected', '详情待接入'],
    ['unverified-target', 'unverified-target', '目标待核验'],
  ] as const)('把 unavailable/%s 稳定映射为 %s', (reason, state, message) => {
    const intent: NavigationIntentDTO = { kind: 'unavailable', reason }

    expect(resolveNavigationTarget(intent, { label: '项目入口' })).toEqual({
      state,
      label: reason === 'forbidden' ? null : '项目入口',
      message,
    })
  })

  it('只为项目详情附加已校验的列表来源上下文', () => {
    const returnTo = '/project?nav=origin_313#project-row-real%3Aproject-1'

    expect(resolveNavigationTarget(projectIntent(), {
      returnTo,
      returnContextId: 'origin_313',
    })).toEqual({
      state: 'resolved',
      label: '中央项目一号',
      to: `/project/project%2Fcentral-001?origin=real&returnTo=${encodeURIComponent(returnTo)}&returnContext=origin_313`,
    })
  })

  it('空白稳定 ID 退化为 missing，不生成项目根路径', () => {
    expect(resolveNavigationTarget(projectIntent({
      subject: {
        state: 'resolved',
        entity: 'project',
        id: '   ',
        label: '空身份项目',
        no: null,
      },
    }))).toEqual({
      state: 'missing',
      label: '空身份项目',
      message: '未记录稳定身份',
    })
  })

  it('entity ref 的 missing/forbidden 状态不会按 label 或编号回退', () => {
    expect(resolveNavigationTarget(projectIntent({
      subject: {
        state: 'missing',
        entity: 'project',
        id: null,
        label: null,
        reason: 'not-recorded',
      },
    }))).toEqual({ state: 'missing', label: null, message: '未记录稳定身份' })

    expect(resolveNavigationTarget(projectIntent({
      subject: {
        state: 'forbidden',
        entity: 'project',
        id: 'project-secret',
        label: null,
        reason: 'permission-denied',
      },
    }), { label: '不能泄露的项目名' })).toEqual({
      state: 'forbidden',
      label: null,
      message: '无查看权限',
    })
  })

  it.each([
    [
      'missing',
      {
        state: 'missing',
        entity: 'project',
        id: null,
        label: null,
        reason: 'not-recorded',
      },
      { state: 'missing', label: null, message: '未记录稳定身份' },
    ],
    [
      'forbidden',
      {
        state: 'forbidden',
        entity: 'project',
        id: 'project-secret',
        label: null,
        reason: 'permission-denied',
      },
      { state: 'forbidden', label: null, message: '无查看权限' },
    ],
    [
      'blank-id',
      {
        state: 'resolved',
        entity: 'project',
        id: '   ',
        label: '空身份项目',
        no: null,
      },
      { state: 'missing', label: '空身份项目', message: '未记录稳定身份' },
    ],
  ] as const)('same-route-overlay/%s 先遵守 subject 状态', (_case, subject, expected) => {
    const intent = {
      kind: 'same-route-overlay',
      subject,
      view: 'summary',
    } as NavigationIntentDTO

    expect(resolveNavigationTarget(intent, { label: '不能越权保留的名称' })).toEqual(expected)
  })

  it('未登记实体保持 not-connected，路由构造异常保持 error', () => {
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: {
        state: 'resolved',
        entity: 'warehouse',
        id: 'warehouse-1',
        label: '一号仓',
        no: null,
      },
      variant: 'detail',
      view: null,
      filters: {},
    })).toEqual({ state: 'not-connected', label: '一号仓', message: '详情待接入' })

    expect(resolveNavigationTarget(projectIntent({
      subject: {
        state: 'resolved',
        entity: 'project',
        id: '\uD800',
        label: '坏 ID',
        no: null,
      },
    }))).toEqual({ state: 'error', label: '坏 ID', message: '目标解析失败' })
  })
})
