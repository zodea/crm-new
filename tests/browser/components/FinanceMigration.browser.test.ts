import type { ProductionAccessStatus } from '~/lib/customer/access-repository'
import type { TransactionDb } from '~/lib/db/coordinator'
import type { FinanceContext } from '~/lib/finance/central-contract'
import type { FinanceMigrationPreview, FinanceMigrationResult, FinanceMigrationSourceProof } from '~/lib/finance/migration-contract'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { defineComponent, h, nextTick } from 'vue'
import FinanceMigrationPanel from '~/components/migration/FinanceMigrationPanel.vue'
import { migrations, runMigrations } from '~/lib/db/migrations'
import { openBrowserSqlite } from '~/lib/db/sqljs'
import { useProductionAccessStore } from '~/stores/production-access'
import { checkFinanceViewports } from '../finance-viewports'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
// The browser reads actual SQLite bytes; Native export is outside this component path.
vi.mock('~/lib/db/connection', () => ({ backupNativeDatabase: vi.fn() }))

const actorId = 'finance-browser-owner'
const workspaceId = 'finance-browser-workspace'
const recoveryKey = 'crm:form-command:v1:finance-import:finance-browser-workspace:finance-browser-owner:new'
const stamp = '2026-10-05T00:00:00.000Z'
const capabilities = [
  'core:migration:write',
  'finance-current:read',
  'finance-current:write',
  'finance-reimbursement:read',
  'finance-reimbursement:write',
  'finance-payment-application:read',
  'finance-payment-application:write',
  'finance-payment-record:read',
  'finance-payment-record:write',
  'finance-invoice-application:read',
  'finance-invoice-application:write',
]
const nativeSources = new Map<number, { bytes: Uint8Array, sha256: string }>()
const externalBytes = new Uint8Array([0, 10, 255])
const fetcher = vi.fn()
let accessStatus: ProductionAccessStatus
let pinia: ReturnType<typeof createPinia>
let receipt: FinanceMigrationResult | null
let sourceVersion = 60

function context(operation: 'migration' | 'preflight'): FinanceContext {
  const sourceVersion = 'finance-readable-revision-1'
  return {
    workspaceId,
    actorId,
    capabilities: [...capabilities],
    sourceVersion,
    asOf: stamp,
    dataOrigin: 'real',
    scope: { kind: 'current', operation },
    meta: {
      schemaVersion: 'finance-read-v1',
      workspaceId,
      actorId,
      capabilities: [...capabilities],
      sourceVersion,
      asOf: stamp,
      dataOrigin: 'real',
      sources: [{ key: 'finance', state: 'readable', sourceVersion, asOf: stamp }],
      authorizedScope: { coverage: 'complete', fingerprint: 'finance-browser-authorized-complete' },
    },
  }
}
function state() {
  return { ...context('migration'), receipts: receipt ? [structuredClone(receipt)] : [] }
}
function preview(source: FinanceMigrationSourceProof): FinanceMigrationPreview {
  return {
    ...context('preflight'),
    sourceBytesSha256: source.sha256,
    nativeSchemaVersion: sourceVersion,
    eligible: true,
    blockingReasons: [],
    records: [
      { kind: 'current', count: 1, deletedCount: 0 },
      { kind: 'reimbursement', count: 0, deletedCount: 0 },
      { kind: 'payment_application', count: 0, deletedCount: 0 },
      { kind: 'payment_record', count: 0, deletedCount: 0 },
      { kind: 'invoice_application', count: 0, deletedCount: 0 },
    ],
    references: [{ entityType: 'suppliers', id: 'native-supplier', label: '原临时金个人身份' }],
    candidates: [{ entityType: 'suppliers', serverId: 'central-supplier', label: '实际已核对分供方', version: '3', sourceVersion: 'supplier-real-revision-3' }],
    originals: [
      { fileId: 'native-original', ownerId: 'native-current', fileName: '原临时金凭证.bin', fileSize: 3, bodyState: 'external-required', canDeclareMissingClearance: false },
      { fileId: 'native-metadata', ownerId: 'native-current', fileName: '历史缺件.pdf', fileSize: 7, bodyState: 'metadata-only', canDeclareMissingClearance: false },
    ],
    retainedReferences: [],
  }
}
function saved(commandId: string, sha256: string): FinanceMigrationResult {
  return { commandId, sourceBytesSha256: sha256, importedAt: stamp, records: [{ kind: 'current', id: 'native-current', version: '1' }], fileIds: ['native-original', 'native-metadata'] }
}
function delayed<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => resolve = done)
  return { promise, resolve }
}
function pendingDescriptor(commandId: string) {
  return { commandId, workspaceId, actorId, family: 'finance-import', targetId: null, action: 'adopt' }
}
function requestCount(url: string) {
  return fetcher.mock.calls.filter(([path]) => path === url).length
}
function calls(url: string) {
  return fetcher.mock.calls.filter(([path]) => path === url)
}
function recovered() {
  return page.getByRole('status').filter({ hasText: '已核对迁入' })
}
function assertMinimumStorage(commandId: string) {
  expect(JSON.parse(sessionStorage.getItem(recoveryKey)!)).toEqual(pendingDescriptor(commandId))
  expect(sessionStorage.getItem(recoveryKey)).not.toMatch(/payloadBase64|原临时金|native-original|sha256|mappings|receipt/)
  expect(localStorage.length).toBe(0)
}
function assertLayout() {
  const panel = document.querySelector<HTMLElement>('[data-testid="finance-migration"]')!
  expect(panel.getBoundingClientRect().width).toBeGreaterThan(0)
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth + 1)
}
async function keyboardActivate(name: string) {
  const button = page.getByRole('button', { name, exact: true })
  await expect.element(button).toBeEnabled()
  button.element().scrollIntoView({ block: 'center' })
  button.element().focus()
  await expect.element(button).toHaveFocus()
  await checkFinanceViewports(assertLayout)
  await userEvent.keyboard('{Enter}')
}
function attach(input: HTMLInputElement, bytes: Uint8Array, name: string) {
  const transfer = new DataTransfer()
  transfer.items.add(new File([Uint8Array.from(bytes).buffer], name))
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}
async function mount() {
  const view = await render(defineComponent({ setup: () => () => h('main', { style: { minWidth: '0', maxWidth: '100%', padding: '12px' } }, h(FinanceMigrationPanel)) }), { global: { plugins: [pinia] } })
  await expect.element(page.getByText(/当前工作区 finance-browser-workspace · 操作者 finance-browser-owner/)).toBeVisible()
  return view
}
async function chooseSource() {
  attach(page.getByLabelText('选择桌面导出的 SQLite 一致快照').element() as HTMLInputElement, nativeSources.get(sourceVersion)!.bytes, `原财务-v${sourceVersion}.sqlite`)
  await expect.element(page.getByRole('combobox', { name: '原分供方：原临时金个人身份 · native-supplier' })).toBeVisible()
  await expect.element(page.getByText(`来源版本 ${sourceVersion} · 原件 2`, { exact: true })).toBeVisible()
}
async function completeMappingAndOriginal() {
  const adopt = page.getByRole('button', { name: '按已核验身份完整采用财务', exact: true })
  await expect.element(adopt).toBeDisabled()
  await page.getByRole('combobox', { name: '原分供方：原临时金个人身份 · native-supplier' }).selectOptions('central-supplier')
  await expect.element(adopt).toBeDisabled()
  await page.getByRole('textbox', { name: '身份对应的确认依据' }).fill('原转账凭证与实际个人身份逐项核对')
  await expect.element(adopt).toBeDisabled()
  const original = page.getByLabelText('补充原字节：原临时金凭证.bin · 3 字节 · native-original').element() as HTMLInputElement
  attach(original, new Uint8Array([1, 2]), '错误大小.bin')
  await expect.element(page.getByRole('alert')).toHaveTextContent('真实大小与旧记录不同')
  await expect.element(adopt).toBeDisabled()
  attach(original, externalBytes, '原临时金凭证.bin')
  await expect.element(adopt).toBeEnabled()
  await expect.element(page.getByText('原库确实只有元数据的历史附件会保留缺件标记，不能当作零字节文件。', { exact: true })).toBeVisible()
  await checkFinanceViewports(assertLayout)
}
async function changeAccess(authenticated: boolean) {
  accessStatus = { mode: 'production', purpose: 'verification', authenticated, ownerId: actorId, expiresAt: '2099-01-01T00:00:00.000Z' }
  await useProductionAccessStore(pinia).check()
  await nextTick()
}

beforeAll(async () => {
  for (const version of [59, 60]) {
    const db = await openBrowserSqlite()
    const execute = async (sql: string, params: unknown[] = []) => {
      db.run(sql, params)
    }
    const select: TransactionDb['select'] = async <T>(sql: string, params: unknown[] = []) => {
      const statement = db.prepare(sql)
      try {
        statement.bind(params)
        const rows: T[] = []
        while (statement.step())
          rows.push(statement.getAsObject() as T)
        return rows
      }
      finally { statement.free() }
    }
    try {
      await runMigrations({ execute, select }, migrations.filter(row => row.version <= version))
      await execute('PRAGMA foreign_keys=ON')
      await execute(`INSERT INTO suppliers(id,name) VALUES('native-supplier','原临时金个人身份')`)
      await execute(`INSERT INTO current_transactions(id,no,direction,supplier_id,counterparty,counterparty_name_snapshot,amount,status) VALUES('native-current','原临时金号','payment','native-supplier','原临时金个人身份','原采用姓名',0,'submitted')`)
      await execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,file_path,mime_type,uploader,uploaded_at) VALUES('native-original','current_transaction','native-current','原临时金凭证.bin',3,'native-external-original.bin','application/octet-stream','原上传人','2026-10-04T00:00:00.000Z')`)
      await execute(`INSERT INTO file_refs(id,owner_type,owner_id,file_name,file_size,mime_type,uploader,uploaded_at) VALUES('native-metadata','current_transaction','native-current','历史缺件.pdf',7,'application/pdf','原上传人','2026-10-04T00:00:00.000Z')`)
      const bytes = db.export()
      const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer)
      nativeSources.set(version, { bytes, sha256: [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('') })
    }
    finally { db.close() }
  }
})
beforeEach(async () => {
  sessionStorage.clear()
  localStorage.clear()
  receipt = null
  sourceVersion = 60
  fetcher.mockReset()
  fetcher.mockImplementation(async (url: string, options?: { body?: { commandId?: string, source?: FinanceMigrationSourceProof } }) => {
    if (url === '/api/read/finance/import')
      return state()
    if (url === '/api/commands/finance/import/preflight')
      return preview(options!.body!.source!)
    if (url === '/api/commands/finance/import') {
      receipt = saved(options!.body!.commandId!, options!.body!.source!.sha256)
      return structuredClone(receipt)
    }
    if (url === '/api/commands/finance/import/resolve')
      return receipt ? { outcome: 'applied', result: structuredClone(receipt) } : { outcome: 'not-applied', commandId: options!.body!.commandId }
    throw new Error(`未预期的业务请求：${url}`)
  })
  pinia = createPinia()
  setActivePinia(pinia)
  vi.stubGlobal('$fetch', fetcher)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { productionAccess: { status: async () => structuredClone(accessStatus) } } }))
  await changeAccess(true)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  sessionStorage.clear()
  localStorage.clear()
})

describe('财务迁入实际 SFC、Native SQLite 文件、原键恢复与五档布局', () => {
  it.each([59, 60])('native v%s 真文件、显式身份/原件核对，提交结果未知后重新挂载只恢复原键', async (version) => {
    sourceVersion = version
    const source = nativeSources.get(version)!
    const view = await mount()
    await chooseSource()
    await completeMappingAndOriginal()
    fetcher.mockImplementationOnce(async () => state())
    fetcher.mockImplementationOnce(async (_url, options) => {
      receipt = saved(options.body.commandId, options.body.source.sha256)
      throw Object.assign(new Error('原提交结果未知，请核对原编号。'), { statusCode: 503 })
    })
    await keyboardActivate('按已核验身份完整采用财务')
    await expect.element(page.getByRole('button', { name: '核对原财务迁入', exact: true })).toBeEnabled()
    const commandId = receipt!.commandId
    assertMinimumStorage(commandId)
    const request = calls('/api/commands/finance/import')[0]![1].body
    expect(request).toMatchObject({ workspaceId, actorId, commandId, source: { sha256: source.sha256 }, mappings: [{ entityType: 'suppliers', legacyId: 'native-supplier', targetId: 'central-supplier', version: '3', sourceVersion: 'supplier-real-revision-3', reason: '原转账凭证与实际个人身份逐项核对' }], originals: [{ fileId: 'native-original', payloadBase64: 'AAr/' }] })
    expect(Uint8Array.from(atob(request.source.payloadBase64), character => character.charCodeAt(0))).toEqual(source.bytes)
    await view.unmount()
    await mount()
    await expect.element(page.getByLabelText('选择桌面导出的 SQLite 一致快照')).toBeDisabled()
    await keyboardActivate('核对原财务迁入')
    await expect.element(recovered()).toHaveTextContent(commandId)
    expect(requestCount('/api/commands/finance/import')).toBe(1)
    expect(calls('/api/commands/finance/import/resolve')[0]![1].body).toEqual({ commandId })
    expect(requestCount('/api/commands/finance/import/resolve')).toBe(1)
    expect(sessionStorage.getItem(recoveryKey)).toBeNull()
    await checkFinanceViewports(assertLayout)
  })

  it('已保存回执后 GET503 保原键，恢复只读不再次 resolve 或 adopt', async () => {
    await mount()
    await chooseSource()
    await completeMappingAndOriginal()
    fetcher.mockImplementationOnce(async () => state())
    fetcher.mockImplementationOnce(async (_url, options) => {
      receipt = saved(options.body.commandId, options.body.source.sha256)
      return structuredClone(receipt)
    })
    fetcher.mockImplementationOnce(async () => {
      throw Object.assign(new Error('已保存后的读取暂不可用。'), { statusCode: 503 })
    })
    await keyboardActivate('按已核验身份完整采用财务')
    await expect.element(page.getByRole('button', { name: '重新读取当前授权', exact: true })).toBeEnabled()
    assertMinimumStorage(receipt!.commandId)
    await keyboardActivate('重新读取当前授权')
    await keyboardActivate('核对原财务迁入')
    await expect.element(recovered()).toHaveTextContent(receipt!.commandId)
    expect(requestCount('/api/commands/finance/import')).toBe(1)
    expect(requestCount('/api/commands/finance/import/resolve')).toBe(0)
    expect(sessionStorage.getItem(recoveryKey)).toBeNull()
    await checkFinanceViewports(assertLayout)
  })

  it('真实授权事件隐藏旧预检，迟到候选不发布；原文件输入可在原身份下再次核验', async () => {
    const late = delayed<unknown>()
    const handler = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, options) => url.endsWith('/preflight') ? late.promise : handler(url, options))
    await mount()
    attach(page.getByLabelText('选择桌面导出的 SQLite 一致快照').element() as HTMLInputElement, nativeSources.get(60)!.bytes, '原财务-v60.sqlite')
    await expect.poll(() => requestCount('/api/commands/finance/import/preflight')).toBe(1)
    await changeAccess(false)
    await expect.element(page.getByRole('alert')).toHaveTextContent('登录已失效')
    late.resolve(preview({ sha256: nativeSources.get(60)!.sha256, payloadBase64: '' }))
    await userEvent.tab()
    await expect.poll(() => document.body.textContent).not.toContain('原临时金个人身份')
    await expect.element(page.getByRole('alert')).toHaveTextContent('登录已失效')
    expect(sessionStorage.length).toBe(0)
    fetcher.mockImplementation(handler)
    await changeAccess(true)
    await keyboardActivate('重新读取当前授权')
    await keyboardActivate('重新核验当前来源')
    await expect.element(page.getByRole('combobox', { name: '原分供方：原临时金个人身份 · native-supplier' })).toBeVisible()
    expect(requestCount('/api/commands/finance/import')).toBe(0)
    await checkFinanceViewports(assertLayout)
  })

  it('原键核对迟到跨授权事件不显示原身份或结果、不清原键', async () => {
    const commandId = 'finance-import-cold-original-key'
    sessionStorage.setItem(recoveryKey, JSON.stringify(pendingDescriptor(commandId)))
    const late = delayed<unknown>()
    receipt = saved(commandId, nativeSources.get(60)!.sha256)
    const handler = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, options) => url.endsWith('/resolve') ? late.promise : handler(url, options))
    await mount()
    await keyboardActivate('核对原财务迁入')
    await expect.poll(() => requestCount('/api/commands/finance/import/resolve')).toBe(1)
    await changeAccess(false)
    await expect.poll(() => document.body.textContent).not.toContain(commandId)
    late.resolve({ outcome: 'applied', result: structuredClone(receipt) })
    await userEvent.tab()
    await expect.poll(() => requestCount('/api/read/finance/import')).toBe(2)
    assertMinimumStorage(commandId)
    expect(document.body.textContent).not.toContain('已核对迁入')
    await expect.element(page.getByRole('alert')).toHaveTextContent('登录已失效')
    await checkFinanceViewports(assertLayout)
  })

  it('卸载后原键核对响应不追加读取或清恢复键，下次界面仍定位原命令', async () => {
    const commandId = 'finance-import-unmounted-original'
    sessionStorage.setItem(recoveryKey, JSON.stringify(pendingDescriptor(commandId)))
    const late = delayed<unknown>()
    receipt = saved(commandId, nativeSources.get(60)!.sha256)
    const handler = fetcher.getMockImplementation()!
    fetcher.mockImplementation((url, options) => url.endsWith('/resolve') ? late.promise : handler(url, options))
    const view = await mount()
    await keyboardActivate('核对原财务迁入')
    await expect.poll(() => requestCount('/api/commands/finance/import/resolve')).toBe(1)
    const count = fetcher.mock.calls.length
    await view.unmount()
    late.resolve({ outcome: 'applied', result: structuredClone(receipt) })
    await userEvent.tab()
    assertMinimumStorage(commandId)
    expect(fetcher.mock.calls).toHaveLength(count)
    fetcher.mockImplementation(handler)
    await mount()
    await expect.element(page.getByRole('status')).toHaveTextContent(commandId)
    await keyboardActivate('核对原财务迁入')
    await expect.element(recovered()).toHaveTextContent(commandId)
    expect(requestCount('/api/commands/finance/import')).toBe(0)
    await checkFinanceViewports(assertLayout)
  })

  it('已保存后迟到 GET 跨授权事件不清键，恢复原身份仍只读既知结果', async () => {
    await mount()
    await chooseSource()
    await completeMappingAndOriginal()
    const late = delayed<unknown>()
    fetcher.mockImplementationOnce(async () => state())
    fetcher.mockImplementationOnce(async (_url, options) => {
      receipt = saved(options.body.commandId, options.body.source.sha256)
      return structuredClone(receipt)
    })
    fetcher.mockImplementationOnce(async () => late.promise)
    await keyboardActivate('按已核验身份完整采用财务')
    await expect.poll(() => receipt?.commandId).toBeTruthy()
    const commandId = receipt!.commandId
    await expect.poll(() => requestCount('/api/read/finance/import')).toBe(5)
    await changeAccess(false)
    late.resolve(state())
    await userEvent.tab()
    assertMinimumStorage(commandId)
    expect(document.body.textContent).not.toContain(commandId)
    expect(document.body.textContent).not.toContain('已核对迁入')
    await expect.element(page.getByRole('alert')).toHaveTextContent('登录已失效')
    await changeAccess(true)
    await keyboardActivate('重新读取当前授权')
    await keyboardActivate('核对原财务迁入')
    await expect.element(recovered()).toHaveTextContent(commandId)
    expect(requestCount('/api/commands/finance/import')).toBe(1)
    expect(requestCount('/api/commands/finance/import/resolve')).toBe(0)
    expect(sessionStorage.getItem(recoveryKey)).toBeNull()
    await checkFinanceViewports(assertLayout)
  })
})
