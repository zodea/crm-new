import type { TestDb } from '../helpers/memory-db'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { LATEST_VERSION } from '~/lib/db/migrations'
import { createCoreMigrationLocalSource } from '~/lib/migration/core-local-source'
import { parseCoreMigrationSourceCommand } from '../../server/utils/core-migration-request'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let memory: TestDb
async function unused(): Promise<never> {
  throw new Error('本例只读来源包')
}
function readSource() {
  return createCoreMigrationLocalSource({
    isNative: () => false,
    isDemoActive: () => false,
    currentSchemaVersion: async () => LATEST_VERSION,
    select: (sql, params) => memory.select(sql, params),
    closeDatabase: unused,
    loadProductionSnapshot: unused,
    readSnapshotSource: unused,
    createBackup: unused,
    loadBackup: unused,
    restoreBackup: unused,
    activateMigration: unused,
    clearMigration: unused,
    prepareMigration: unused,
    loadMigrationMarker: unused,
    loadPendingMigrationMarker: unused,
    now: () => '2026-09-11T00:00:00.000Z',
  }).readSource()
}
beforeEach(async () => {
  memory = await createMigratedMemoryDb()
  await memory.execute('INSERT INTO projects (id, name) VALUES (\'project-q442\', \'工程量项目\')')
})
afterEach(() => memory.close())

it('真实BOQ迁移目录保持量价空零、楼栋归属与规范更新时间，不预先叠加变更', async () => {
  await memory.execute('INSERT INTO contracts (id, name, kind, project_id) VALUES (\'contract-q442\', \'施工合同\', \'施工\', \'project-q442\')')
  await memory.execute('INSERT INTO boq_files (id, contract_id, file_name) VALUES (\'file-q442\', \'contract-q442\', \'真实清单.xlsx\')')
  await memory.execute(`INSERT INTO boq_lines (id, boq_file_id, project_id, contract_id, item_name, qty, unit_price, building, updated_at)
    VALUES ('unknown', 'file-q442', 'project-q442', 'contract-q442', '未知量价', NULL, NULL, '一栋', '2026-09-11 01:02:03'),
      ('zero', 'file-q442', 'project-q442', 'contract-q442', '明确零', 0, 0, '二栋', '2026-09-11 01:02:04')`)
  await memory.execute('INSERT INTO buildings (id, project_id, code, name) VALUES (\'building-boq-q442\', \'project-q442\', \'B1\', \'一栋\')')
  await memory.execute(`INSERT INTO boq_lines (id, boq_file_id, project_id, contract_id, item_name, deleted_at)
    VALUES ('hidden', 'file-q442', 'project-q442', 'contract-q442', '后来隐藏的历史BOQ', '2026-09-11 01:00:00')`)
  const source = await readSource()
  const catalog = JSON.parse(String(source.entities.construction_contracts[0]!.attributes!.boqCatalogJson))
  expect(catalog).toEqual([
    expect.objectContaining({ id: 'unknown', qty: null, unitPrice: null, building: '一栋', updatedAt: '2026-09-11T01:02:03.000Z' }),
    expect.objectContaining({ id: 'zero', qty: 0, unitPrice: 0, building: '二栋', updatedAt: '2026-09-11T01:02:04.000Z' }),
  ])
  const graph = JSON.parse(String(source.entities.quantity_projects![0]!.attributes!.graphJson))
  expect(graph.boqReferences).toContainEqual({ id: 'hidden', projectId: 'project-q442', contractId: 'contract-q442', deletedAt: '2026-09-11T01:00:00.000Z' })
})

it('有真实工程量的项目进入可选逻辑拓扑且HTTP不改变源包，旧包未提供该节点仍保持原样', async () => {
  await memory.execute('INSERT INTO buildings (id, project_id, code, name) VALUES (\'building-q442\', \'project-q442\', \'B1\', \'一栋\')')
  const source = await readSource()
  expect(source.entities.quantity_projects).toHaveLength(1)
  const entity = source.entities.quantity_projects![0]!
  expect(entity).toMatchObject({ legacyId: 'project-q442', references: { projectId: 'project-q442' } })
  expect(JSON.parse(String(entity.attributes!.graphJson)).tables.buildings).toEqual([expect.objectContaining({ id: 'building-q442', project_id: 'project-q442' })])
  const request = { workspaceId: 'workspace-default', actorId: 'actor-default', requiredCapability: 'core:migration:write', commandId: 'quantity-source', source, backup: null }
  expect(parseCoreMigrationSourceCommand(request).source).toEqual(source)
  delete source.entities.quantity_projects
  delete source.expectations?.counts?.quantity_projects
  expect(parseCoreMigrationSourceCommand(request).source).toEqual(source)
})
