import type { SQLInputValue } from 'node:sqlite'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createDbCoordinator } from '../../app/lib/db/coordinator'
import { newQuotationDraft } from '../../app/lib/material-quotation/contract'
import { ensureMaterialQuotationSchema } from '../../app/lib/material-quotation/schema-upgrade'
import { createQuotationOwner } from '../../app/lib/material-quotation/sqlite-owner'
/** A physical historical source only; never a production or user database. */
export async function createQuotationMigrationSource(directory: string) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, 'original-native-quotation.sqlite')
  const raw = new DatabaseSync(path)
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(58);
    CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT); INSERT INTO projects VALUES('source-project-id','原项目真实资料');
    CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT); INSERT INTO suppliers VALUES('source-supplier-id','原分供方真实资料');
    CREATE TABLE file_refs(id TEXT PRIMARY KEY,owner_type TEXT,owner_id TEXT,file_name TEXT,file_path TEXT,file_size INTEGER,mime_type TEXT,category TEXT,uploader TEXT,uploaded_at TEXT,deleted_at TEXT);
    CREATE TABLE file_payloads(file_ref_id TEXT PRIMARY KEY REFERENCES file_refs(id),encoding TEXT,content TEXT);`)
  const coordinator = createDbCoordinator(async () => ({ async execute(sql, params) {
    if (params)
      raw.prepare(sql).run(...params as SQLInputValue[])
    else
      raw.exec(sql)
  }, async select<T>(sql: string, params: unknown[] = []) {
    return raw.prepare(sql).all(...params as SQLInputValue[]) as T[]
  }, async close() {
    if (raw.isOpen)
      raw.close()
  } }))
  const actor = { workspaceId: 'native-source-workspace', actorId: 'native-source-actor', capabilities: ['material-quotation:read', 'material-quotation:write', 'project:list:read', 'supplier:list:read'] }
  const owner = createQuotationOwner({ ...coordinator, identity: actor, assertBusinessWrite() {
  } }, { payloadMode: 'native', references: async () => ({ projects: [{ id: 'source-project-id', name: '原项目真实资料' }], suppliers: [{ id: 'source-supplier-id', name: '原分供方真实资料' }] }) })
  const draft = { ...newQuotationDraft(), partyName: '原报价方未更名', scope: 'project' as const, projectId: 'source-project-id', supplierId: 'source-supplier-id', lines: [{ ...newQuotationDraft().lines[0]!, id: 'source-quotation-line', name: '原始材料', unit: '米', unitPrice: 0, taxRate: null }] }
  try {
    await coordinator.withTransaction(ensureMaterialQuotationSchema)
    const first = await owner.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-quotation:write', commandId: 'native-original-command-one', baseVersion: null, action: 'save', draft, attachments: { add: [{ fileName: '原报价正文.txt', fileSize: 3, mimeType: 'text/plain', payloadBase64: 'YWJj' }] } }, () => actor)
    await owner.execute({ workspaceId: actor.workspaceId, actorId: actor.actorId, requiredCapability: 'material-quotation:write', commandId: 'native-original-command-two', id: first.id, baseVersion: '1', action: 'save', draft: { ...draft, lines: [{ ...draft.lines[0]!, unitPrice: null, taxRate: 0 }] }, attachments: {} }, () => actor)
    await coordinator.close()
    return { path, bytes: await readFile(path), id: first.id, fileId: first.attachmentIds[0]!, projectId: draft.projectId, supplierId: draft.supplierId }
  }
  finally {
    await coordinator.close()
  }
}
