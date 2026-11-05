import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { randomUUID, scryptSync } from 'node:crypto'
import { once } from 'node:events'
import { lstatSync, readdirSync, realpathSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import { migrations, runMigrations } from '../app/lib/db/migrations'
import { readInvoiceWorkbookStyleReadback } from '../app/lib/invoice/excel'
import { isolatedInheritedEnvironment, isolatedServerEntry } from '../scripts/e2e-isolation'
import { createMemoryDb } from '../tests/helpers/memory-db'
import { createCrewWorkerProductionFixture } from './helpers/crew-worker-production-fixture'

test.skip(process.env.CRM_INVOICE_ACCEPTANCE !== '1', '仅在明确指定的独立测试层构建与合成数据库中运行')
if (process.env.CRM_INVOICE_ACCEPTANCE === '1') {
  const supplied = process.env.CRM_INVOICE_E2E_DOWNLOADS
  if (!supplied || !isAbsolute(supplied))
    throw new Error('必须指定项目临时目录内的新建下载目录。')
  const temp = resolve('.tmp')
  const downloads = resolve(supplied)
  const nested = relative(temp, downloads)
  if (lstatSync(temp).isSymbolicLink() || realpathSync(temp).toLowerCase() !== temp.toLowerCase()
    || !nested || nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested)
    || !lstatSync(downloads).isDirectory() || lstatSync(downloads).isSymbolicLink() || realpathSync(downloads).toLowerCase() !== downloads.toLowerCase()
    || readdirSync(downloads).length !== 0) {
    throw new Error('验收下载目录必须是项目临时目录内新建的空目录，且不能经过链接。')
  }
  test.use({ launchOptions: { downloadsPath: downloads } })
}

test('旧票迁入与备份恢复后，以真实中央目录下载台账 Excel', async ({ page }, info) => {
  test.setTimeout(240_000)
  const entry = process.env.CRM_INVOICE_E2E_ENTRY
  if (!entry)
    throw new Error('必须指定包含发票台账测试层的隔离构建入口。')
  const serverEntry = isolatedServerEntry(process.cwd(), entry)
  const fixture = await createCrewWorkerProductionFixture(page, info, { serverEntry: entry, requireIsolated: true })
  const old = await createMemoryDb()
  let bytes: Buffer
  try {
    await runMigrations(old, migrations.filter(row => row.version <= 60))
    await old.execute(`INSERT INTO projects(id,name) VALUES('old-ledger-project','合成旧项目')`)
    for (const [id, number, total] of [['old-ledger-unknown', '000000000000000021', 0], ['old-ledger-known', '000000000000000022', 123.45]] as const) {
      await old.execute(`INSERT INTO invoices(id,source,invoice_number,invoice_date,seller,amount,tax_amount,total_amount,project_id,owner_kind,ocr_status,review_status,account_status,dup_status,archived_at,print_count,print_rotation,items) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, 'excel', number, '2026-01-01', '合成销售方', 0, 0, total, 'old-ledger-project', 'project', 'done', 'reviewed', 'archived', 'normal', '2026-01-02T00:00:00.000Z', 0, 0, '[]'])
    }
    bytes = Buffer.from(old.raw.export())
  }
  finally { old.close() }
  let recoveredServer: ReturnType<typeof spawn> | null = null
  let serverLog = ''
  try {
    await page.addInitScript(() => Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined }))
    await fixture.start()
    await fixture.login()
    const identity = { workspaceId: 'crew-browser-workspace', actorId: 'crew-browser-owner' }
    const projectResponse = await fixture.request('/api/commands/projects', { method: 'POST', data: { ...identity, requiredCapability: 'project:write', commandId: 'ledger-accept-project', baseVersion: null, action: 'draft', draft: { name: '合成真实项目台账', manager: '合成经办人', status: '筹备中' }, attachments: {} } })
    expect(projectResponse.ok(), await projectResponse.text()).toBe(true)
    const project = await projectResponse.json() as { id: string }
    await page.goto(`${fixture.origin}/settings/data-migration`)
    const panel = page.getByRole('region', { name: '旧发票迁入' })
    await panel.getByLabel('选择完整 SQLite 快照').setInputFiles({ name: 'synthetic-ledger.sqlite', mimeType: 'application/octet-stream', buffer: bytes })
    const mapping = panel.getByLabel(/项目：合成旧项目/)
    await expect(mapping).toBeEnabled()
    await mapping.selectOption(project.id)
    await panel.getByRole('button', { name: '核对映射与历史付款' }).click()
    await expect(panel.getByText('映射预检通过；提交时会再次核对。')).toBeVisible()
    await panel.getByRole('button', { name: '确认迁入', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认迁入', exact: true }).click()
    await expect(panel.getByText(/已核对迁入批次/)).toBeVisible()
    const before = await fixture.request('/api/read/invoices/old-ledger-unknown')
    expect(before.ok(), await before.text()).toBe(true)
    expect(await before.json()).toMatchObject({ record: { id: 'old-ledger-unknown', ownerKind: 'project', projectId: project.id, fields: { invoiceNumber: '000000000000000021', totalAmount: null } } })
    await fixture.stop()
    const backupDir = join(fixture.directory, 'ledger-backup')
    const restoreDir = join(fixture.directory, 'ledger-restore')
    await mkdir(backupDir)
    await mkdir(restoreDir)
    const script = `const {registerHooks}=require('node:module'),{pathToFileURL}=require('node:url'),path=require('node:path');registerHooks({resolve(s,c,n){if(s.startsWith('~/'))s=pathToFileURL(path.resolve('app',s.slice(2))).href;let r;try{r=n(s,c)}catch(e){if((s.startsWith('.')||s.startsWith('file:'))&&e.code==='ERR_MODULE_NOT_FOUND')r=n(s+'.ts',c);else throw e}return r.url.endsWith('.json')?{...r,importAttributes:{...r.importAttributes,type:'json'}}:r}});(async()=>{const {createProductionStorage}=await import('./server/utils/production-storage.ts');const {createLocalBackup,restoreBackupIsolated}=await import('./server/utils/production-backup-package.ts');const [directory,backupDir,restoreDir,id]=process.argv.slice(1);const storage=createProductionStorage({directory,workspaceId:'crew-browser-workspace',ownerId:'crew-browser-owner',purpose:'verification'});try{const backup=await createLocalBackup(storage,backupDir,id,()=>new Date().toISOString());const restored=await restoreBackupIsolated(backupDir,id,restoreDir,'ledger-cold');process.stdout.write(JSON.stringify({restored,backup}));}finally{await storage.close()}})().catch(e=>{process.stderr.write(String(e));process.exitCode=1})`
    const { execFileSync } = await import('node:child_process')
    const restored = JSON.parse(execFileSync(process.execPath, ['--experimental-transform-types', '-e', script, fixture.directory, backupDir, restoreDir, `backup-${randomUUID()}`], { cwd: process.cwd(), encoding: 'utf8', windowsHide: true })) as { restored: { directory: string, inventory: { schemaVersion: number } } }
    expect(restored.restored.directory).toBe(join(restoreDir, 'ledger-cold'))
    expect(restored.restored.inventory.schemaVersion).toBe(32)
    const salt = '0123456789abcdef0123456789abcdef'
    const hash = `scrypt$${salt}$${scryptSync('crew-worker-synthetic-access-only', Buffer.from(salt, 'hex'), 64).toString('hex')}`
    const port = new URL(fixture.origin).port
    recoveredServer = spawn(process.execPath, [serverEntry], { cwd: resolve('.'), windowsHide: true, env: { ...isolatedInheritedEnvironment(process.env), NODE_ENV: 'production', CRM_RUN_MODE: 'production', CRM_DATA_DIRECTORY: restored.restored.directory, CRM_WORKSPACE_ID: identity.workspaceId, CRM_OWNER_ID: identity.actorId, CRM_DATA_PURPOSE: 'verification', CRM_PUBLIC_ORIGIN: fixture.origin, CRM_ACCESS_CODE_HASH: hash, NITRO_HOST: '127.0.0.1', NITRO_PORT: port, PORT: port }, stdio: ['ignore', 'pipe', 'pipe'] })
    recoveredServer.stdout!.on('data', chunk => serverLog += String(chunk))
    recoveredServer.stderr!.on('data', chunk => serverLog += String(chunk))
    await expect.poll(() => {
      if (recoveredServer?.exitCode !== null)
        throw new Error(serverLog)
      return serverLog.includes(`Listening on ${fixture.origin}`)
    }, { timeout: 30000 }).toBe(true)
    await expect.poll(async () => {
      if (recoveredServer?.exitCode !== null)
        throw new Error(serverLog)
      try {
        return (await fetch(`${fixture.origin}/api/auth/status`)).status
      }
      catch { return 0 }
    }, { timeout: 30000 }).toBe(200)
    await fixture.login()
    await page.goto(`${fixture.origin}/invoice-ledger-acceptance`)
    await expect(page.getByRole('heading', { name: '发票台账' })).toBeVisible()
    await expect(page.getByText('000000000000000021')).toBeVisible()
    await expect(page.getByText('000000000000000022')).toBeVisible()
    await page.getByRole('button', { name: '导出 Excel' }).click()
    await expect(page.getByText('未统计（金额缺失或超出范围）')).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '确认导出' }).click()])
    expect(download.suggestedFilename()).toMatch(/^发票台账_\d{4}-\d{2}-\d{2}\.xlsx$/)
    const downloaded = info.outputPath('central-invoice-ledger.xlsx')
    await download.saveAs(downloaded)
    const file = await readFile(downloaded)
    const workbook = XLSX.read(file, { type: 'buffer' })
    const sheet = workbook.Sheets['发票台账']!
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null })
    const data = rows.filter(row => row[1] === '000000000000000021' || row[1] === '000000000000000022')
    expect(data).toHaveLength(2)
    const unknown = data.find(row => row[1] === '000000000000000021')!
    const known = data.find(row => row[1] === '000000000000000022')!
    expect(unknown[4]).toBeNull()
    expect(known[4]).toBe(123.45)
    expect(data.map(row => row[5])).toEqual(['合成真实项目台账', '合成真实项目台账'])
    expect(sheet['!merges']?.map(range => XLSX.utils.encode_range(range))).toContain('F3:F4')
    expect(rows.at(-1)?.[4]).toBe('未统计（金额缺失或超出范围）')
    const style = await readInvoiceWorkbookStyleReadback(file)
    expect(style.issues).toEqual([])
    expect(style.sheets[0]).toMatchObject({ freezeRows: 2, mergedCells: expect.arrayContaining(['A1:H1']) })
    expect(style.sheets[0]!.cells.A1).toMatchObject({ font: { name: '等线', sz: 16, bold: true }, alignment: { horizontal: 'center' } })
    expect(style.sheets[0]!.cells.A2).toMatchObject({ font: { name: '等线', sz: 14, bold: true }, border: { top: { style: 'thin' }, bottom: { style: 'thin' } } })
  }
  finally {
    if (recoveredServer && recoveredServer.exitCode === null) {
      const exited = once(recoveredServer, 'exit')
      recoveredServer.kill()
      await exited
    }
    if (serverLog)
      await info.attach('ledger-restored-server-log', { body: serverLog, contentType: 'text/plain' })
    await fixture.cleanup()
  }
})
