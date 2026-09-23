import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { credentialProblem } from '../../app/lib/supplier/credential-contract'
import { createSupplierCredentialState } from '../../app/lib/supplier/credential-state'
import { supplierPendingKey } from '../../app/lib/supplier/pending'
import { credentialSnapshot } from '../supplier/credential-ui-fixtures'

const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  vi.stubGlobal('window', { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } })
})
afterEach(() => vi.unstubAllGlobals())

it('证照原件失响应冷恢复只凭原键核对，正文不进浏览器持久层且不二次上传', async () => {
  const snapshot = credentialSnapshot()
  snapshot.capabilities.push('supplier:persistent:write')
  const read = vi.fn().mockResolvedValue(snapshot)
  const execute = vi.fn().mockRejectedValue(credentialProblem('unavailable', 'response lost'))
  const result = { commandId: 'credential-command-453', supplierId: snapshot.supplierId, credentialId: 'credential-453', auditId: 'audit-453', deletionToken: null, supplierVersion: '2', credentialVersion: '2' }
  const production = { resolve: vi.fn().mockResolvedValue({ commandId: result.commandId, outcome: 'applied', result }) }
  const repository = { read, execute, file: vi.fn() }
  const target = () => ({ supplierId: snapshot.supplierId, origin: 'real' as const, enabled: true })
  const first = createSupplierCredentialState(repository, target, () => result.commandId, production)
  await first.load()
  await expect(first.execute({ action: 'upload', draft: { category: '营业执照', validFrom: '', expiresAt: '', longTerm: true, fileName: 'secret.png', mimeType: 'image/png', fileSize: 3, payloadBase64: 'YWJj' } })).rejects.toThrow('response lost')
  expect([...values.values()]).toEqual([result.commandId])
  const cold = createSupplierCredentialState(repository, target, () => 'must-not-submit', production)
  read.mockResolvedValue({ ...snapshot, supplierVersion: '2', credentialVersion: '2' })
  await cold.load()
  expect(production.resolve).toHaveBeenCalledWith(result.commandId)
  expect(cold.data.value?.credentialVersion).toBe('2')
  expect(values.size).toBe(0)
  expect(execute).toHaveBeenCalledTimes(1)
})

it('冷恢复最终回读撤权时保留原键，不把待核对操作误清为成功', async () => {
  const snapshot = credentialSnapshot()
  snapshot.capabilities.push('supplier:persistent:write')
  const key = supplierPendingKey(snapshot, `credential:${snapshot.supplierId}`)
  values.set(key, 'original-credential-command')
  const read = vi.fn().mockResolvedValueOnce(snapshot).mockRejectedValueOnce(credentialProblem('forbidden', '已撤回读取权限'))
  const repository = { read, execute: vi.fn(), file: vi.fn() }
  const production = { resolve: vi.fn().mockResolvedValue({ commandId: 'original-credential-command', outcome: 'not-applied', result: null }) }
  const state = createSupplierCredentialState(repository, () => ({ supplierId: snapshot.supplierId, origin: 'real', enabled: true }), undefined, production)
  await expect(state.load()).rejects.toThrow('已撤回读取权限')
  expect(values.get(key)).toBe('original-credential-command')
  expect(state.canWrite.value).toBe(false)
  expect(state.recoveryNotice.value).toBe('')
})
