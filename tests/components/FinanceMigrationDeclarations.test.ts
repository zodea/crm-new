import { createHash, webcrypto } from 'node:crypto'
import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, it, vi } from 'vitest'
import FinanceMigrationPanel from '~/components/migration/FinanceMigrationPanel.vue'
import { CENTRAL_FINANCE_KINDS, FINANCE_CAPABILITIES, FINANCE_IMPORT_CAPABILITY } from '~/lib/finance/central-contract'
import { createReadMeta, withReadMeta } from '../../server/utils/read-meta'

vi.mock('~/lib/db/native-snapshot', () => ({ inspectNativeMigrationSnapshot: async (bytes: Uint8Array) => ({ sha256: createHash('sha256').update(bytes).digest('hex'), schemaVersion: 60 }) }))
const actor = { workspaceId: 'migration-workspace', actorId: 'migration-owner', capabilities: [FINANCE_IMPORT_CAPABILITY, ...FINANCE_CAPABILITIES] }
function envelope(operation: 'migration' | 'preflight', body: object) {
  const scope = { kind: 'current', operation }
  return withReadMeta({ ...actor, scope, dataOrigin: 'real', ...body }, createReadMeta({ session: actor, schemaVersion: 'finance-read-v1', operation: `finance:${operation}`, dataOrigin: 'real', asOf: '2026-10-05T01:00:00.000Z', sources: [{ key: 'finance', state: 'readable', sourceVersion: 'finance-1', asOf: '2026-10-05T01:00:00.000Z' }], coverage: 'complete', scope }))
}
async function open() {
  let receipt: object | null = null
  let failRead = false
  const posts: Record<string, unknown>[] = []
  let resolves = 0
  vi.stubGlobal('$fetch', async (url: string, options?: { body: Record<string, unknown> }) => {
    if (url === '/api/read/finance/import') {
      if (failRead)
        throw new Error('已保存迁入后GET不可用')
      return envelope('migration', { receipts: receipt ? [receipt] : [] })
    }
    if (url.endsWith('/preflight')) {
      const source = options!.body.source as { sha256: string }
      return envelope('preflight', { sourceBytesSha256: source.sha256, nativeSchemaVersion: 60, eligible: true, blockingReasons: [], records: CENTRAL_FINANCE_KINDS.map(kind => ({ kind, count: kind === 'reimbursement' ? 2 : 0, deletedCount: 0 })), references: [], candidates: [], retainedReferences: [], originals: [{ fileId: 'missing-clearance-file', ownerId: 'actual-clearance-head', fileName: '遗失清偿原单.bin', fileSize: null, bodyState: 'external-required', canDeclareMissingClearance: true }, { fileId: 'expense-file', ownerId: 'actual-expense-head', fileName: '成本原件.bin', fileSize: 4, bodyState: 'external-required', canDeclareMissingClearance: false }] })
    }
    if (url === '/api/commands/finance/import') {
      posts.push(structuredClone(options!.body))
      receipt = { commandId: options!.body.commandId, sourceBytesSha256: (options!.body.source as { sha256: string }).sha256, importedAt: '2026-10-05T01:00:00.000Z', records: [], fileIds: ['expense-file'] }
      failRead = true
      return receipt
    }
    if (url.endsWith('/resolve')) {
      resolves++
      return { outcome: 'applied', result: receipt }
    }
    throw new Error('未声明的测试请求')
  })
  render(FinanceMigrationPanel, { global: { plugins: [createPinia()] } })
  await flushPromises()
  const source = new File(['unit-selected-source'], 'selected.sqlite', { type: 'application/octet-stream' })
  Object.defineProperty(source, 'arrayBuffer', { value: async () => new TextEncoder().encode('unit-selected-source').buffer })
  await fireEvent.change(screen.getByLabelText('选择桌面导出的 SQLite 一致快照'), { target: { files: [source] } })
  await waitFor(() => expect(screen.getByRole('checkbox', { name: '声明旧清偿原单缺失 遗失清偿原单.bin' })).toBeTruthy())
  return { posts, resolves: () => resolves, allowRead: () => {
    failRead = false
  } }
}
beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
  vi.stubGlobal('crypto', webcrypto)
})

it('仅server精确C候选可声明且null大小保未知；理由与E原正文不完整时阻采用', async () => {
  const f = await open()
  expect(screen.getByText(/遗失清偿原单.bin · 原大小未知/)).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: '声明旧清偿原单缺失 成本原件.bin' })).toBeNull()
  const adopt = screen.getByRole('button', { name: '按已核验身份完整采用财务' })
  await fireEvent.click(screen.getByRole('checkbox', { name: '声明旧清偿原单缺失 遗失清偿原单.bin' }))
  expect(adopt.hasAttribute('disabled')).toBe(true)
  await fireEvent.update(screen.getByRole('textbox', { name: '原单缺失说明 遗失清偿原单.bin' }), '已核实本旧清偿原单遗失，原路径与未知大小保全，后续用原账签收核验')
  expect(adopt.hasAttribute('disabled')).toBe(true)
  expect(f.posts).toEqual([])
})

it('声明捕获于原POST且已知后读失败仅GET恢复，sessionStorage仅六字段不保存声明/body', async () => {
  const f = await open()
  await fireEvent.click(screen.getByRole('checkbox', { name: '声明旧清偿原单缺失 遗失清偿原单.bin' }))
  await fireEvent.update(screen.getByRole('textbox', { name: '原单缺失说明 遗失清偿原单.bin' }), '该精确旧C原单遗失，原NULL大小与路径不猜改')
  await fireEvent.change(screen.getByLabelText(/补充原字节：成本原件.bin/), { target: { files: [new File([new Uint8Array([1, 2, 3, 4])], '成本原件.bin')] } })
  const adopt = screen.getByRole('button', { name: '按已核验身份完整采用财务' })
  await waitFor(() => expect(adopt.hasAttribute('disabled')).toBe(false))
  await fireEvent.click(adopt)
  await waitFor(() => expect(screen.getByRole('button', { name: '核对原财务迁入' }).hasAttribute('disabled')).toBe(false))
  expect(f.posts).toHaveLength(1)
  expect(f.posts[0]!.declaredMissingOriginals).toEqual([{ fileId: 'missing-clearance-file', reason: '该精确旧C原单遗失，原NULL大小与路径不猜改' }])
  expect(f.posts[0]!.originals).toEqual([{ fileId: 'expense-file', payloadBase64: 'AQIDBA==' }])
  const descriptors = Object.entries(sessionStorage).filter(([key]) => key.startsWith('crm:form-command:v1:finance-import:')).map(([, value]) => JSON.parse(value))
  expect(descriptors).toHaveLength(1)
  expect(Object.keys(descriptors[0]).sort()).toEqual(['action', 'actorId', 'commandId', 'family', 'targetId', 'workspaceId'])
  f.allowRead()
  await fireEvent.click(screen.getByRole('button', { name: '核对原财务迁入' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '核对原财务迁入' })).toBeNull())
  expect(f.posts).toHaveLength(1)
  expect(f.resolves()).toBe(0)
})
