import type { ProcessLibraryCreateCommand } from '../../app/lib/schedule/process-library-contract'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { expect, it } from 'vitest'
import { processLibraryProductionProcess } from '../helpers/production-process-library-process'

it('独立服务进程公开保存后丢弃响应并重启，原键恢复原图且并开旧版仍按原身份解析', async () => {
  const f = await processLibraryProductionProcess()
  const command: ProcessLibraryCreateCommand = { action: 'create-version', commandId: 'restart-library-first', workspaceId: 'process-workspace', actorId: 'process-owner', origin: 'real', requiredCapability: 'process-library:write', baseVersion: 0, sourceVersion: null, draft: { sourceLibraryId: null, code: 'RESTART', name: '重启工序库', description: '原版始终保留', tasks: [{ key: 'one', name: '第一道', durationDays: 2, trade: '木工', color: '#123456', stageCode: 'S1', itemCodes: ['I1', 'I2'], predecessorKey: null, predecessorDisabled: false }, { key: 'two', name: '第二道', durationDays: 4, trade: '泥水工', color: '#654321', stageCode: 'S2', itemCodes: ['I3'], predecessorKey: 'one', predecessorDisabled: false }] } }
  try {
    await f.start()
    await f.login()
    const submitted = await f.request('/api/commands/process-libraries', command)
    expect(submitted.status).toBe(200)
    await submitted.body!.cancel()
    const catalog = await (await f.request('/api/read/process-libraries?origin=real')).json()
    expect(catalog.libraries).toHaveLength(1)
    const id = catalog.libraries[0].id
    const original = await (await f.request(`/api/read/process-libraries/${id}?origin=real`)).json()
    await f.stop()
    await f.start()
    expect((await f.request('/api/read/process-libraries?origin=real')).status).toBe(401)
    await f.login()
    expect(await (await f.request('/api/commands/process-libraries', command)).json()).toEqual({ id, commandId: command.commandId, version: 1, sourceVersion: '1' })
    expect(await (await f.request(`/api/read/process-libraries/${id}?origin=real`)).json()).toEqual(original)
    const next = { ...command, commandId: 'restart-library-second', baseVersion: 1, sourceVersion: '1', draft: { ...command.draft, sourceLibraryId: id, name: '第二版' } }
    expect(await (await f.request('/api/commands/process-libraries', next)).json()).toMatchObject({ version: 2 })
    expect(await (await f.request('/api/commands/process-libraries', command)).json()).toMatchObject({ id, version: 1 })
    expect((await f.request('/api/commands/process-libraries', { ...command, draft: { ...command.draft, name: '同键异文' } })).status).toBe(409)
    expect((await f.request('/api/commands/process-libraries', { ...next, commandId: 'stale-series' })).status).toBe(409)
    expect((await f.request('/api/commands/process-libraries', { ...next, commandId: 'forged-actor', actorId: 'other-owner' })).status).toBe(403)
    expect((await f.request('/api/commands/process-libraries', { ...next, origin: 'demo' })).status).toBe(403)
    expect((await f.request('/api/read/process-libraries?origin=demo')).status).toBe(403)
    expect((await f.request('/api/read/process-libraries?origin=real', undefined, { 'x-ruihang-test-session': 'forged-test' })).status).toBe(403)
    const raw = new DatabaseSync(join(f.directory, 'ruihang.sqlite'))
    raw.exec('CREATE TRIGGER fail_library_audit BEFORE INSERT ON process_library_audits BEGIN SELECT RAISE(ABORT,\'synthetic-before-commit\'); END')
    raw.close()
    const interrupted = { ...next, commandId: 'restart-library-third', baseVersion: 2 }
    expect((await f.request('/api/commands/process-libraries', interrupted)).status).toBe(500)
    const repair = new DatabaseSync(join(f.directory, 'ruihang.sqlite'))
    repair.exec('DROP TRIGGER fail_library_audit')
    repair.close()
    await f.stop()
    await f.start()
    await f.login()
    expect(await (await f.request('/api/read/process-libraries?origin=real')).json()).toMatchObject({ sourceVersion: '2', seriesVersions: { RESTART: 2 } })
    expect(await (await f.request('/api/commands/process-libraries', interrupted)).json()).toMatchObject({ version: 3 })
    expect(await (await f.request(`/api/read/process-libraries/${id}?origin=real`)).json()).toEqual(original)
    expect((await f.request('/api/auth/logout', {})).status).toBe(200)
    expect((await f.request('/api/commands/process-libraries', command)).status).toBe(401)
  }
  finally { await f.stop() }
}, 90000)
