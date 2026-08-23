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
        entity: 'crew',
        id: 'crew-1',
        label: '一班组',
        no: null,
      },
      variant: 'detail',
      view: null,
      filters: {},
    })).toEqual({ state: 'not-connected', label: '一班组', message: '详情待接入' })

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
