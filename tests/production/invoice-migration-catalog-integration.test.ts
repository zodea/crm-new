import type { ProductionStorage } from '../../server/utils/production-storage'
import { expect, it } from 'vitest'
import { createInvoiceMigrationCatalogClient } from '../../app/lib/invoice/central-migration-catalog'
import { readInvoiceMigrationCatalog } from '../../server/utils/production-invoice-migration-catalog'
import { createMemoryDb } from '../helpers/memory-db'

it('真实项目目录经服务端同事务读取并由客户端核验身份、版本和缺失来源', async () => {
  const db = await createMemoryDb()
  try {
    db.raw.run(`CREATE TABLE production_metadata(singleton INTEGER, workspace_id TEXT, owner_id TEXT);
      CREATE TABLE production_participants(domain TEXT, schema_version INTEGER);
      CREATE TABLE project_revision(singleton INTEGER, revision INTEGER);
      CREATE TABLE projects(id TEXT, name TEXT, code TEXT, customer_id TEXT, secondary_customer_id TEXT, draft_json TEXT, version INTEGER, updated_at TEXT, deleted_at TEXT);
      INSERT INTO production_metadata VALUES(1,'workspace-one','actor-one');
      INSERT INTO production_participants VALUES('project',1);
      INSERT INTO project_revision VALUES(1,3);
      INSERT INTO projects VALUES('project-one','合成项目','P-1',NULL,NULL,'{"name":"合成项目","code":"P-1"}',2,'2026-01-01T00:00:00.000Z',NULL);`)
    const actor = { workspaceId: 'workspace-one', actorId: 'actor-one', capabilities: ['finance-invoice:read', 'finance-invoice:import', 'project:list:read'] }
    const storage = { identity: { workspaceId: actor.workspaceId, actorId: actor.actorId }, withTransaction: async (work: (tx: typeof db) => unknown) => work(db) } as unknown as ProductionStorage
    const client = createInvoiceMigrationCatalogClient({
      identity: actor,
      context: async () => actor,
      fetcher: async (_url, options) => readInvoiceMigrationCatalog(storage, () => actor, (options.body as { requested: ['projects'] }).requested),
    })
    expect(await client.load(['projects'])).toEqual({ projects: [{ id: 'project-one', label: '合成项目', version: '2', sourceVersion: 'projects:3' }], suppliers: [], contracts: [] })
    db.raw.run('UPDATE project_revision SET revision=4')
    expect((await client.load(['projects'])).projects[0]?.sourceVersion).toBe('projects:4')
    db.raw.run('DELETE FROM production_participants WHERE domain=\'project\'')
    await expect(client.load(['projects'])).rejects.toMatchObject({ problem: { code: 'unavailable' } })
  }
  finally {
    db.close()
  }
})
