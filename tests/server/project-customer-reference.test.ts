import type { BusinessSession } from '../../server/utils/business-session'
import type { ProjectListSourceRow } from '~/lib/project/repository'
import { createServer } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, getHeader, getQuery, getRouterParam, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CUSTOMER_WRITE_CAPABILITY } from '~/lib/customer/command-contract'
import { createHttpProjectListRepository } from '~/lib/project/http-repository'
import { buildProjectDetailRead, decodeProjectDetailRead, decodeProjectListPage, parseProjectDetailQuery } from '~/lib/project/repository'
import { customerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { customerReadTestInstance } from '../../server/utils/customer-read-test-instance'
import { resolveProjectCustomerReferences } from '../../server/utils/project-import-customers'
import { createProjectReadTestInstance, PROJECT_READ_FIXTURE } from '../../server/utils/project-read-test-instance'
import { withReadMeta } from '../../server/utils/read-meta'
import { projectSnapshotEvidence } from '../helpers/project-read-meta'

const sessionId = 'project-customer-reference-boundary'
const actor: BusinessSession = { workspaceId: 'workspace-default', actorId: 'actor-default', capabilities: ['customer:list:read', CUSTOMER_WRITE_CAPABILITY] }
const query = { includeDemo: false, search: '', status: null, filters: { statuses: [], plannedEnds: [], managers: [], customerIds: [] }, sort: 'updated-desc' as const, page: 1, pageSize: 10 as const }
afterEach(() => {
  customerReadTestInstance.reset('ready', sessionId)
  customerCommandTestInstance.reset(sessionId)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.doUnmock('../../server/utils/project-read-test-instance')
  vi.doUnmock('../../server/utils/production-project-runtime')
})

function projectRow(customerId: string): ProjectListSourceRow {
  return { ...PROJECT_READ_FIXTURE[0]!, dataOrigin: 'real', id: 'project-readable', name: '独立可读项目', contractAmount: 1234.56, customerId, customerName: '客户旧缓存名称', customerPermission: 'allowed', secondaryCustomerId: customerId, secondaryCustomerName: '次客户旧缓存名称', secondaryCustomerPermission: 'allowed' }
}

describe('项目本体与客户关联来源独立读取', () => {
  it.each(['forbidden', 'unavailable'] as const)('%s 清除关联身份与名称，本体、独立金额及恢复重读保持有效', async (scenario) => {
    const created = await customerCommandTestInstance.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: CUSTOMER_WRITE_CAPABILITY, commandId: `customer-for-${scenario}`, action: 'save', baseVersion: null, draft: { name: '恢复后可读客户', aliases: [], contact: '客户联系人', status: 'active' }, attachments: {} }, actor, sessionId)
    const row = projectRow(created.id)
    const instance = createProjectReadTestInstance(() => ['project:list:read'], () => [row], () => 'project-real-v1', undefined, async () => 0, async () => [], resolveProjectCustomerReferences)
    const repository = createHttpProjectListRepository({ fetcher: async (url, options) => url === '/api/read/projects' ? instance.list(options?.query, sessionId) : instance.detail('project-readable', options?.query, sessionId) })
    customerReadTestInstance.reset(scenario, sessionId)
    const page = await repository.list(query)
    expect(page.pagination.total).toBe(1)
    expect(page.items[0]!.project).toEqual({ state: 'resolved', entity: 'project', id: 'project-readable', label: '独立可读项目', no: row.code })
    expect(page.items[0]!.contractAmount).toBe('1234.56')
    expect(page.items[0]!.customer).toEqual({ state: scenario, entity: 'customer', id: null, label: null, reason: scenario === 'forbidden' ? 'permission-denied' : 'source-unavailable' })
    expect(page.items[0]!.secondaryCustomer).toEqual(page.items[0]!.customer)
    expect(page.summary.facets.customers).toEqual([])
    expect(JSON.stringify(page)).not.toContain(created.id)
    expect(JSON.stringify(page)).not.toContain('客户旧缓存名称')
    const detail = await repository.get({ id: 'project-readable', origin: 'real', includeDemo: false })
    expect(detail.item.project.id).toBe('project-readable')
    expect(detail.item.customer.state).toBe(scenario)
    const filtered = await repository.list({ ...query, filters: { ...query.filters, customerIds: [created.id] } })
    expect(filtered.items).toEqual([])
    const searched = await repository.list({ ...query, search: '客户旧缓存名称' })
    expect(searched.items).toEqual([])
    customerReadTestInstance.reset('ready', sessionId)
    const recovered = await repository.get({ id: 'project-readable', origin: 'real', includeDemo: false })
    expect(recovered.item.customer).toEqual({ state: 'resolved', entity: 'customer', id: created.id, label: '恢复后可读客户', no: null })
    expect(recovered.item.project.id).toBe('project-readable')
    expect(row.customerName).toBe('客户旧缓存名称')
    expect(customerCommandTestInstance.resolve(`customer-for-${scenario}`, actor, sessionId)).toEqual({ outcome: 'applied', result: created })
  })

  it('页面与详情 decoder 拒绝 forbidden/unavailable 的隐藏ID及旧定位字段', async () => {
    const row = projectRow('hidden-customer')
    const instance = createProjectReadTestInstance(() => ['project:list:read'], () => [row], () => 'project-real-v1')
    const page = await instance.list({ includeDemo: 'false' })
    for (const state of ['forbidden', 'unavailable'] as const) {
      const reference = { state, entity: 'customer', id: null, label: null, reason: state === 'forbidden' ? 'permission-denied' : 'source-unavailable' }
      const valid = { ...page, items: [{ ...page.items[0], customer: reference }] }
      expect(decodeProjectListPage(valid).items[0]!.customer.id).toBeNull()
      for (const changed of [{ ...reference, id: 'hidden-customer' }, { ...reference, targetId: 'hidden-customer' }, { ...reference, label: '敏感客户名称' }]) {
        expect(() => decodeProjectListPage({ ...valid, items: [{ ...valid.items[0], customer: changed }] })).toThrow('无效')
      }
      const input = { rows: [{ ...row, customerPermission: state, customerName: null }], query: parseProjectDetailQuery(row.id, { origin: 'real' }), asOf: '2026-10-04T00:00:00.000Z', sourceVersion: 'public-boundary', capabilities: ['project:list:read'] }
      const detail = withReadMeta(buildProjectDetailRead(input), projectSnapshotEvidence(input).real)
      expect(decodeProjectDetailRead(detail).item.customer.id).toBeNull()
      expect(() => decodeProjectDetailRead({ ...detail, item: { ...detail.item, customer: { ...reference, id: 'hidden-customer' } } })).toThrow('无效')
    }
  })

  it('真实 HTTP 列表和详情保留独立项目，客户关联来源失败、撤权及恢复均不回落旧身份', async () => {
    const created = await customerCommandTestInstance.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: CUSTOMER_WRITE_CAPABILITY, commandId: 'customer-http-boundary', action: 'save', baseVersion: null, draft: { name: '恢复可读的真实客户', contact: '联系人', status: 'active' }, attachments: {} }, actor, sessionId)
    const row = projectRow(created.id)
    const instance = createProjectReadTestInstance(() => ['project:list:read'], () => [row], () => 'project-real-http-v1', undefined, async () => 0, async () => [], resolveProjectCustomerReferences)
    vi.doMock('../../server/utils/project-read-test-instance', () => ({ projectReadTestInstance: instance }))
    vi.doMock('../../server/utils/production-project-runtime', () => ({ productionProjectRuntime: () => null }))
    for (const [key, value] of Object.entries({ defineEventHandler, getQuery, getHeader, getRouterParam, createError }))
      vi.stubGlobal(key, value)
    const listRoute = (await import('../../server/api/read/projects.get')).default
    const detailRoute = (await import('../../server/api/read/projects/[id].get')).default
    const router = createRouter().get('/api/read/projects', listRoute).get('/api/read/projects/:id', detailRoute)
    const server = createServer(toNodeListener(createApp().use(router)))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('测试 HTTP 未返回端口')
      const repository = createHttpProjectListRepository({ fetcher: async (path, options) => {
        const url = new URL(path, `http://127.0.0.1:${address.port}`)
        for (const [key, value] of Object.entries(options?.query ?? {})) {
          if (value !== null && value !== undefined)
            url.searchParams.set(key, String(value))
        }
        const response = await fetch(url, { headers: { 'x-ruihang-test-session': sessionId } })
        const body = await response.json()
        if (!response.ok)
          throw Object.assign(new Error('HTTP read failed'), { data: body.data ?? body })
        return body
      } })
      for (const state of ['unavailable', 'forbidden'] as const) {
        customerReadTestInstance.reset(state, sessionId)
        const page = await repository.list(query)
        const detail = await repository.get({ id: 'project-readable', origin: 'real', includeDemo: false })
        expect(page.items[0]!.project.id).toBe('project-readable')
        expect(detail.item.project.id).toBe('project-readable')
        expect(page.items[0]!.customer).toEqual({ state, entity: 'customer', id: null, label: null, reason: state === 'unavailable' ? 'source-unavailable' : 'permission-denied' })
        expect(detail.item.customer).toEqual(page.items[0]!.customer)
        expect(JSON.stringify([page, detail])).not.toContain(created.id)
        expect(JSON.stringify([page, detail])).not.toContain('客户旧缓存名称')
      }
      customerReadTestInstance.reset('ready', sessionId)
      const restored = await repository.get({ id: 'project-readable', origin: 'real', includeDemo: false })
      expect(restored.item.customer).toEqual({ state: 'resolved', entity: 'customer', id: created.id, label: '恢复可读的真实客户', no: null })
      expect(customerCommandTestInstance.resolve('customer-http-boundary', actor, sessionId)).toEqual({ outcome: 'applied', result: created })
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(cause => cause ? reject(cause) : resolve()))
    }
  })
})
