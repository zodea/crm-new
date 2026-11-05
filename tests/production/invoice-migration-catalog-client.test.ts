import { expect, it } from 'vitest'
import { createInvoiceMigrationCatalogClient, createInvoiceWorkspaceCatalogClient } from '../../app/lib/invoice/central-migration-catalog'

it('只接受当前身份下完整可读且版本一致的目标目录', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:import', 'project:list:read'] }
  const entry = { id: 'project-one', label: '项目一', version: '1', sourceVersion: 'projects:4' }
  const response = { context: actor, asOf: '2026-01-01T00:00:00.000Z', sources: [{ key: 'projects', state: 'readable', sourceVersion: 'projects:4' }], projects: [entry], suppliers: [], contracts: [] }
  let reply: unknown = response
  let permitted = true
  const client = createInvoiceMigrationCatalogClient({ identity: actor, context: async () => permitted ? actor : { ...actor, capabilities: [] }, fetcher: async () => reply })
  expect(await client.load(['projects'])).toEqual({ projects: [entry], suppliers: [], contracts: [] })
  reply = { ...response, sources: [{ key: 'projects', state: 'forbidden', sourceVersion: null }], projects: [] }
  await expect(client.load(['projects'])).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  reply = { ...response, projects: [{ ...entry, sourceVersion: 'projects:3' }] }
  await expect(client.load(['projects'])).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  reply = response
  permitted = false
  await expect(client.load(['projects'])).rejects.toMatchObject({ problem: { code: 'forbidden' } })
})

it('工作台只要求发票读取权限，并核对目录来源与权限变化', async () => {
  const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'project:list:read'] }
  const entry = { id: 'project-one', label: '项目一', version: '1', sourceVersion: 'projects:4' }
  const response = { context: actor, asOf: '2026-01-01T00:00:00.000Z', sources: [{ key: 'projects', state: 'readable', sourceVersion: 'projects:4' }], projects: [entry], suppliers: [], contracts: [] }
  let calls = 0
  let path = ''
  const client = createInvoiceWorkspaceCatalogClient({ identity: actor, context: async () => actor, fetcher: async (url) => {
    path = url
    return response
  } })
  expect(await client.load(['projects'])).toEqual({ projects: [entry], suppliers: [], contracts: [] })
  expect(path).toBe('/api/read/invoices/workspace-catalog')
  const revoked = createInvoiceWorkspaceCatalogClient({ identity: actor, context: async () => ++calls === 1 ? actor : { ...actor, capabilities: [] }, fetcher: async () => response })
  await expect(revoked.load(['projects'])).rejects.toMatchObject({ problem: { code: 'forbidden' } })
})
