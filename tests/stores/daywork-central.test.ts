// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useDayworkCentralStore } from '~/stores/daywork-central'
import { createPayrollC2ServiceFixture } from '../helpers/payroll-c2-service-fixture'

beforeEach(() => {
  sessionStorage.clear()
  setActivePinia(createPinia())
  vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => vi.unstubAllGlobals())
it('原保存成功后冷读失败仍保原键，随后同ID合法移项目改人改日也能确认原成功并提示后续变化', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    const saved = await f.daywork()
    const repo = { ...f.service, dayworkForm: vi.fn(f.service.dayworkForm) }
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: repo } }))
    const store = useDayworkCentralStore()
    const read = await store.loadDayworkForm({ origin: 'real' }, { recordId: saved.recordId })
    await store.saveDaywork(read, { ...f.record, note: '原窗口明确保存的备注' })
    const original = store.getDayworkPending(read)!
    expect(original.state).toBe('awaiting-read')
    repo.dayworkForm.mockRejectedValueOnce(new Error('后读断线'))
    await expect(store.loadDayworkForm({ origin: 'real' }, { recordId: saved.recordId })).rejects.toThrow('后读断线')
    expect(store.getDayworkPending(read)?.command).toEqual(original.command)
    const latest = await f.service.dayworkForm({ origin: 'real' }, { recordId: saved.recordId })
    await f.service.executeDaywork(f.dayworkCommand(latest, { kind: 'save-daywork', record: { ...f.record, projectId: 'other-project', workerId: 'outside', workDate: '2026-09-02', note: '另一窗口后续合法修改' } }))
    setActivePinia(createPinia())
    const cold = useDayworkCentralStore()
    await cold.recoverDaywork(original)
    const refreshed = await cold.loadDayworkForm({ origin: 'real' }, { recordId: saved.recordId })
    expect(refreshed.record).toMatchObject({ projectId: 'other-project', workerId: 'outside', workDate: '2026-09-02' })
    expect(cold.acknowledgeDaywork(original, refreshed)).toEqual({ changedSinceCommand: true })
    expect(cold.getDayworkPending(read)).toBeNull()
    expect((await f.service.dayworkForm({ origin: 'real' }, { recordId: saved.recordId })).record?.note).toBe('另一窗口后续合法修改')
  }
  finally { await f.close() }
})

it('新增签工以原草稿键完成，预览、拷贝修改的读取和其他记录都不能解除原操作', async () => {
  const f = await createPayrollC2ServiceFixture()
  try {
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { payroll: f.service } }))
    const store = useDayworkCentralStore()
    const empty = await store.loadDayworkForm({ origin: 'real' }, { recordId: null, draftKey: 'stable-new-draft' })
    const result = await store.saveDaywork(empty, f.record)
    const original = store.getDayworkPending(empty)!
    expect(original.command.draftKey).toBe('stable-new-draft')
    const preview = await store.loadDayworkForm({ origin: 'real' }, { recordId: result.recordId, draft: {} })
    expect(() => store.acknowledgeDaywork(original, preview)).toThrow()
    const another = await f.daywork({ workerId: 'member' })
    const wrong = await store.loadDayworkForm({ origin: 'real' }, { recordId: another.recordId })
    expect(() => store.acknowledgeDaywork(original, wrong)).toThrow()
    const changed = await store.loadDayworkForm({ origin: 'real' }, { recordId: result.recordId })
    changed.record!.note = '本地伪造的后读'
    expect(() => store.acknowledgeDaywork(original, changed)).toThrow()
    const good = await store.loadDayworkForm({ origin: 'real' }, { recordId: result.recordId })
    expect(store.acknowledgeDaywork(original, good)).toEqual({ changedSinceCommand: false })
    expect(store.getDayworkPending(empty)).toBeNull()
  }
  finally { await f.close() }
})
