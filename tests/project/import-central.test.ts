import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { useImportRunner } from '~/composables/useImportRunner'
import { getImportEntity } from '~/lib/kit/import-entities'
import { autoMatchColumns, buildImportRows } from '~/lib/kit/import-mapping'
import { createHttpProjectCommandRepository } from '~/lib/project/command-http-repository'
import { annotateProjectImportRows } from '~/lib/project/import'
import { parseWorkbookForMapping } from '~/lib/util/excel'
import { useProjectStore } from '~/stores/project'
import { useProjectCommandStore } from '~/stores/project-command'
import { createCustomerCommandTestInstance } from '../../server/utils/customer-command-test-instance'
import { createCustomerReadTestInstance } from '../../server/utils/customer-read-test-instance'
import { createProjectCommandTestInstance } from '../../server/utils/project-command-test-instance'
import { createProjectReadTestInstance } from '../../server/utils/project-read-test-instance'
import { createMigratedMemoryDb } from '../helpers/memory-db'

let local: TestDb
vi.mock('~/lib/db/connection', () => ({
  execute: (sql: string, params?: unknown[]) => local.execute(sql, params),
  select: (sql: string, params?: unknown[]) => local.select(sql, params),
}))

afterEach(() => {
  local?.close()
  vi.unstubAllGlobals()
})

describe('项目 Excel → 实际存储 → 中央回读', () => {
  it('同一合成身份经真实解析与实体入口导入后，中央列表和详情能回读，本地不产生正式项目', async () => {
    local = await createMigratedMemoryDb()
    await local.execute('INSERT INTO customers (id, name) VALUES (?, ?)', ['customer-import-408', '导入复现甲方408'])
    setActivePinia(createPinia())
    vi.stubGlobal('useProjectStore', useProjectStore)
    vi.stubGlobal('useProjectCommandStore', useProjectCommandStore)
    const session = { workspaceId: 'import-408', actorId: 'actor-408', capabilities: ['project:write', 'project:list:read', 'customer:write', 'customer:list:read'] }
    const customerCommands = createCustomerCommandTestInstance({ createId: () => 'customer-import-408' })
    await customerCommands.execute({ ...session, requiredCapability: 'customer:write', commandId: 'customer-408', baseVersion: null, action: 'save', draft: { name: '导入复现甲方408', contact: '合成联系人408' }, attachments: {} }, session)
    const customerReads = createCustomerReadTestInstance(() => session.capabilities, id => customerCommands.rows(id), id => customerCommands.sourceVersion(id), undefined, undefined, undefined, () => session)
    const commands = createProjectCommandTestInstance({ createId: () => 'project-import-408', validateImportCustomers: async (draft) => {
      expect((await customerReads.list({ includeDemo: 'false' })).items.map(item => item.customer.id)).toContain(draft.customerId)
    } })
    const reads = createProjectReadTestInstance(() => session.capabilities, id => commands.rows(id), id => commands.sourceVersion(id))
    const repository = createHttpProjectCommandRepository({ fetcher: async (url, options) => {
      if (url === '/api/read/business-session')
        return session
      if (url === '/api/commands/projects')
        return commands.execute(options!.body as never, session)
      if (url === '/api/read/projects/project-import-408/form')
        return commands.form('project-import-408', session)
      throw new Error(`Unexpected URL: ${url}`)
    } })
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { projectCommands: repository, customerRead: { list: (query: Record<string, unknown>) => customerReads.list(query) } } }))
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ['项目名称', '客户', '项目经理', '业务流程阶段', '外部旧ID'],
      ['Excel中央复现408', 'customer-import-408', '合成经理408', '施工中', 'EXCEL-408-001'],
    ]), '合成项目408')
    const parsed = (await parseWorkbookForMapping(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }))).sheets[0]!
    const entity = getImportEntity('project')!
    const rows = annotateProjectImportRows(buildImportRows(autoMatchColumns(parsed.columns, entity.fields), parsed.rows), parsed)
    const runner = useImportRunner({ yieldToView: async () => {} })
    expect(await runner.start(rows, entity.importRow, entity.validateRow)).toEqual({ status: 'completed' })
    const central = await reads.list({ includeDemo: 'false' })
    const localRows = await local.select('SELECT id, name, customer_id FROM projects WHERE name = ?', ['Excel中央复现408'])
    expect({ localRows, centralItems: central.items }).toMatchObject({
      localRows: [],
      centralItems: [{ project: { id: 'project-import-408', label: 'Excel中央复现408' }, dataOrigin: 'real' }],
    })
    expect(await reads.detail('project-import-408', { dataOrigin: 'real' })).toMatchObject({
      item: { project: { id: 'project-import-408', label: 'Excel中央复现408' } },
    })
  })
})
