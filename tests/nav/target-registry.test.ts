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

  it('仅为 DOC01 两类甲方单据按稳定 ID 进入中央只读详情，其他种类仍不猜路由', () => {
    const returnTo = '/owner/change?search=%E6%A1%A5%E6%9E%B6&origin=real&nav=origin_323#owner-document-row-real%3Aowner_change%3Achange-1'
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'owner-document', id: 'change-1', label: '变更一', no: 'BG-001' },
      variant: 'change',
      view: null,
      filters: { dataOrigin: 'real' },
    }, { returnTo, returnContextId: 'origin_323' })).toEqual({
      state: 'resolved',
      label: '变更一',
      to: `/owner/change/change-1?origin=real&returnTo=${encodeURIComponent(returnTo)}&returnContext=origin_323`,
    })

    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'owner-document', id: 'final-settlement-1', label: '竣工结算一', no: 'JS-001' },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'real', documentKind: 'final-settlement' },
    })).toMatchObject({ state: 'unverified-target', label: '竣工结算一' })
  })

  it('施工合同 BOQ 只按正式项目与合同稳定 ID 进入专属工作台', () => {
    const intent = {
      kind: 'entity-subview' as const,
      subject: { state: 'resolved' as const, entity: 'contract' as const, id: 'contract-320', label: '施工合同', no: 'SG-320' },
      variant: 'boq',
      view: null,
      filters: { dataOrigin: 'real', contractKind: '施工', projectId: 'project-320' },
    }
    expect(resolveNavigationTarget(intent)).toEqual({
      state: 'resolved',
      label: '施工合同',
      to: '/contract/boq?project=project-320&contract=contract-320',
    })
    expect(resolveNavigationTarget({ ...intent, filters: { ...intent.filters, dataOrigin: 'demo' } }))
      .toMatchObject({ state: 'error' })

    expect(resolveNavigationTarget({
      ...intent,
      view: 'change-source-323',
      filters: { ...intent.filters, boqTab: 'changes' },
    })).toMatchObject({
      state: 'resolved',
      to: '/contract/boq?project=project-320&contract=contract-320&tab=changes&focus=change-source-323',
    })
  })

  it('从甲方商务单据下钻项目、客户或合同时保留原详情返回链', () => {
    const returnTo = '/owner/report/report-323?origin=real&returnTo=%2Fproject%2Fproject-323%3Forigin%3Dreal'
    const resolved = resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'customer', id: 'customer-323', label: '甲方客户', no: null },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'real' },
    }, { returnTo })
    expect(resolved).toEqual({
      state: 'resolved',
      label: '甲方客户',
      to: `/base/customer/customer-323?origin=real&returnTo=${encodeURIComponent(returnTo)}`,
    })
  })

  it('甲方单据来源进入中央施工合同事实行，并保留原详情返回链', () => {
    const returnTo = '/owner/report/report-323?origin=real'
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-323', label: '施工合同', no: 'SG-323' },
      variant: 'owner-document-source',
      view: 'report-323',
      filters: { dataOrigin: 'real', contractKind: '施工', ownerTab: 'settlements' },
    }, { returnTo })).toEqual({
      state: 'resolved',
      label: '施工合同',
      to: `/contract/contract-323?origin=real&contractKind=construction&tab=settlements&focus=report-323&returnTo=${encodeURIComponent(returnTo)}`,
    })

    const acceptanceReturnTo = '/owner/acceptance/acceptance-324?origin=real&variant=warranty'
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-323', label: '施工合同', no: 'SG-323' },
      variant: 'owner-document-source',
      view: 'acceptance-324',
      filters: { dataOrigin: 'real', contractKind: '施工', ownerTab: 'acceptance', ownerView: 'warranty' },
    }, { returnTo: acceptanceReturnTo })).toEqual({
      state: 'resolved',
      label: '施工合同',
      to: `/contract/contract-323?origin=real&contractKind=construction&tab=acceptance&focus=acceptance-324&focusView=warranty&returnTo=${encodeURIComponent(acceptanceReturnTo)}`,
    })
  })

  it('最终结算详情及其补充协议、收款来源均保留专属详情返回链', () => {
    const returnTo = '/owner/final-settlement/final-settlement-325?origin=real'
    const document = resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'owner-document', id: 'final-settlement-325', label: '最终结算', no: 'JS-325' },
      variant: 'final-settlement',
      view: null,
      filters: { dataOrigin: 'real' },
    })
    expect(document).toEqual({
      state: 'resolved',
      label: '最终结算',
      to: '/owner/final-settlement/final-settlement-325?origin=real',
    })

    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'contract', id: 'contract-325', label: '施工合同', no: 'SG-325' },
      variant: 'supplement',
      view: 'supplement-325',
      filters: { dataOrigin: 'real', contractKind: '施工' },
    }, { returnTo })).toMatchObject({
      state: 'resolved',
      to: expect.stringContaining(`returnTo=${encodeURIComponent(returnTo)}`),
    })

    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'receipt', id: 'receipt-325', label: '一期工程款', no: 'SK-325' },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'real', customerId: 'customer-325' },
    }, { returnTo })).toMatchObject({
      state: 'resolved',
      to: expect.stringContaining(`returnTo=${encodeURIComponent(returnTo)}`),
    })
  })

  it('甲方罚扣只按 penalty 变体进入专属详情并保留返回链', () => {
    const returnTo = '/owner/penalty?origin=real&nav=origin_326#owner-document-row-real%3Aowner_penalty%3Aowner-penalty-326'
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'owner-document', id: 'owner-penalty-326', label: '施工进度延误', no: 'FK-326' },
      variant: 'penalty',
      view: null,
      filters: { dataOrigin: 'real' },
    }, { returnTo, returnContextId: 'origin_326' })).toEqual({
      state: 'resolved',
      label: '施工进度延误',
      to: `/owner/penalty/owner-penalty-326?origin=real&returnTo=${encodeURIComponent(returnTo)}&returnContext=origin_326`,
    })
  })

  it.each(['acceptance', 'warranty'] as const)('验收 canonical ID 可解析到 %s 双视图并保留来源返回链', (variant) => {
    const returnTo = `/owner/acceptance?variant=${variant}&origin=real&nav=origin_324#owner-document-row-real%3Aacceptance%3Aacceptance-324`
    const normalizedReturnTo = `/owner/acceptance?origin=real&variant=${variant}&nav=origin_324#owner-document-row-real%3Aacceptance%3Aacceptance-324`
    expect(resolveNavigationTarget({
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'owner-document', id: 'acceptance-324', label: '项目竣工验收', no: 'YS-324' },
      variant,
      view: null,
      filters: { dataOrigin: 'real' },
    }, { returnTo, returnContextId: 'origin_324' })).toEqual({
      state: 'resolved',
      label: '项目竣工验收',
      to: `/owner/acceptance/acceptance-324?origin=real&variant=${variant}&returnTo=${encodeURIComponent(normalizedReturnTo)}&returnContext=origin_324`,
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

  it('客户事实穿透项目时只保留同来源的受限详情返回链', () => {
    const returnTo = '/base/customer/customer-1?origin=demo&tab=receipts'
    const intent = projectIntent({
      subject: {
        state: 'resolved',
        entity: 'project',
        id: 'project-1',
        label: '项目一',
        no: null,
      },
      filters: { dataOrigin: 'demo', customerId: 'customer-1' },
    })

    expect(resolveNavigationTarget(intent, { returnTo })).toEqual({
      state: 'resolved',
      label: '项目一',
      to: `/project/project-1?origin=demo&returnTo=${encodeURIComponent(returnTo)}`,
    })
    expect(resolveNavigationTarget({ ...intent, filters: { dataOrigin: 'real' } }, { returnTo }))
      .toEqual({ state: 'resolved', label: '项目一', to: '/project/project-1?origin=real' })
    expect(resolveNavigationTarget({ ...intent, filters: { dataOrigin: 'demo', customerId: 'customer-2' } }, { returnTo }))
      .toEqual({ state: 'resolved', label: '项目一', to: '/project/project-1?origin=demo' })
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

  it('项目分供方身份卡仅向匹配的项目与分供方详情附加工作台返回链', () => {
    const returnTo = '/project/project-1/supplier/supplier-1?origin=demo&tab=overview'
    const project = projectIntent({
      subject: { state: 'resolved', entity: 'project', id: 'project-1', label: '项目一', no: null },
      filters: { dataOrigin: 'demo' },
    })
    const supplier: NavigationIntentDTO = {
      kind: 'entity-detail',
      subject: { state: 'resolved', entity: 'supplier', id: 'supplier-1', label: '分供方一', no: null },
      variant: 'detail',
      view: null,
      filters: { dataOrigin: 'demo' },
    }

    expect(resolveNavigationTarget(project, { returnTo })).toEqual({
      state: 'resolved',
      label: '项目一',
      to: `/project/project-1?origin=demo&returnTo=${encodeURIComponent(returnTo)}`,
    })
    expect(resolveNavigationTarget(supplier, { returnTo })).toEqual({
      state: 'resolved',
      label: '分供方一',
      to: `/base/supplier/supplier-1?origin=demo&returnTo=${encodeURIComponent(returnTo)}`,
    })
    expect(resolveNavigationTarget({
      ...project,
      subject: { ...project.subject, id: 'project-other' },
    }, { returnTo })).toEqual({
      state: 'resolved',
      label: '项目一',
      to: '/project/project-other?origin=demo',
    })
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
