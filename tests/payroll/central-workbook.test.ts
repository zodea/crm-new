import { expect, it } from 'vitest'
import { decodePayrollWorkbookRead, encodePayrollWorkbookRead } from '../../app/lib/payroll/workbook-codec'
import { createPayrollWorkbookFixture as fixture } from '../helpers/payroll-workbook-fixture'

it('目录正文/回执/版本损坏必须拒绝，不能将不一致归档当作完整文件', async () => {
  const f = await fixture()
  try {
    const saved = await f.archive.executeWorkbook(f.command(await f.preview()))
    const [original] = await f.db.select<{ snapshot_json: string, snapshot_hash: string }>('SELECT snapshot_json,snapshot_hash FROM payroll_workbook_archives')
    const read = () => f.archive.workbookArchive({ origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })
    const corrupted = JSON.parse(original!.snapshot_json)
    corrupted.groups[0].entries[0].document.actualAmount = 99999
    await f.db.execute('UPDATE payroll_workbook_archives SET snapshot_json=?', [JSON.stringify(corrupted)])
    await expect(read()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await f.db.execute('UPDATE payroll_workbook_archives SET snapshot_json=?', [original!.snapshot_json])
    await f.db.execute('UPDATE payroll_workbook_receipts SET result_json=?', [JSON.stringify({ ...saved, version: 2 })])
    await expect(read()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    await f.db.execute('UPDATE payroll_workbook_receipts SET result_json=?', [JSON.stringify(saved)])
    await f.db.execute('UPDATE payroll_workbook_archives SET version=2')
    await expect(read()).rejects.toMatchObject({ problem: { code: 'unavailable' } })
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(1)
  }
  finally { await f.close() }
})

it('回执写入故障和事务中撤权均回滚，恢复后同键重试只保存一份', async () => {
  const f = await fixture()
  try {
    const command = f.command(await f.preview())
    await f.db.execute('CREATE TRIGGER fail_workbook_receipt BEFORE INSERT ON payroll_workbook_receipts BEGIN SELECT RAISE(ABORT,\'simulated workbook receipt failure\'); END')
    await expect(f.archive.executeWorkbook(command)).rejects.toThrow('simulated workbook receipt failure')
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(0)
    await f.db.execute('DROP TRIGGER fail_workbook_receipt')
    const originalSession = structuredClone(f.getArchiveSession())
    f.setAfterOperation(() => f.setArchiveSession({ ...originalSession, capabilities: ['payroll:read'] }))
    await expect(f.archive.executeWorkbook(command)).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(0)
    expect(await f.db.select('SELECT * FROM payroll_workbook_receipts')).toHaveLength(0)
    f.setAfterOperation(undefined)
    f.setArchiveSession(originalSession)
    const results = await Promise.all([f.archive.executeWorkbook(command), f.archive.executeWorkbook(command)])
    expect(results[0]).toEqual(results[1])
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(1)
  }
  finally { await f.close() }
})

it('真实有日期名册和六个照片与固定目录关联；零额离场成员保留且公开目录不含私密正文', async () => {
  const f = await fixture()
  try {
    const roster = await f.prepareRoster()
    expect(roster.members).toHaveLength(3)
    expect(roster.members.find(row => row.workerId === 'zero')?.siteStatus).toBe('left')
    const preview = await f.preview()
    expect(preview.gaps).toEqual([])
    expect(preview.deliveryGaps).toEqual([])
    expect(preview.rosterRef).toMatchObject({ id: roster.id, version: 1, registeredOn: '2026-09-22' })
    const saved = await f.archive.executeWorkbook(f.command(preview))
    f.rosterSource.workers[0]!.name = '后来变名并转项目'
    f.rosterSource.workers[0]!.currentProjectId = 'another-project'
    const read = () => f.archive.workbookArchive({ origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })
    const original = await read()
    expect(original.completeness).toBe('complete')
    expect(original.rosterRef).toEqual(preview.rosterRef)
    expect(JSON.stringify(original)).not.toContain('440000199001010001')
    expect(JSON.stringify(original)).not.toContain('6222000000000001')
    f.setArchiveSession({ ...f.getArchiveSession(), capabilities: ['payroll:read'] })
    const publicRead = await read()
    expect(publicRead.context.readonly).toBe(true)
    expect(decodePayrollWorkbookRead(encodePayrollWorkbookRead(publicRead), 'archive', { origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })).toEqual(publicRead)
    await expect(f.preview()).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    await expect(f.roster.archive('p', roster.id)).rejects.toThrow('私密')
  }
  finally { await f.close() }
})

it('固定照片正文摘要损坏时不创建新目录；预览后权限或名册变化不得偷用旧预览', async () => {
  const f = await fixture()
  try {
    const roster = await f.prepareRoster()
    const preview = await f.preview()
    const photo = roster.members[0]!.photos[0]!
    await f.db.execute('UPDATE file_payloads SET content=? WHERE file_ref_id=(SELECT file_ref_id FROM worker_roster_assets WHERE id=?)', ['YWJj', photo.id])
    await expect(f.archive.executeWorkbook(f.command(preview))).rejects.toThrow()
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(0)
  }
  finally { await f.close() }
})

it('真实已发C2沿正式128号保存目录，缺名册只标部分，不改525核算与原零成员', async () => {
  const f = await fixture()
  try {
    const read = await f.preview()
    expect(decodePayrollWorkbookRead(encodePayrollWorkbookRead(read), 'preview', { origin: 'real' }, f.input)).toEqual(read)
    expect(read.groups).toHaveLength(1)
    expect(read.groups[0]!.entries[0]!.document.actualAmount).toBe(525)
    expect(read.groups[0]!.entries[0]!.document.allocations).toContainEqual(expect.objectContaining({ workerId: 'zero', amount: 0 }))
    expect(read.issues[0]!.number).toBe('128')
    expect(read.gaps).toEqual([])
    expect(read.deliveryGaps).toContainEqual(expect.objectContaining({ kind: 'roster' }))
    const command = f.command(read)
    const saved = await f.archive.executeWorkbook(command)
    expect(await f.archive.executeWorkbook(command)).toEqual(saved)
    const original = await f.archive.workbookArchive({ origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })
    expect(original).toMatchObject({ version: 1, completeness: 'partial', manifestHash: saved.manifestHash })
    expect(decodePayrollWorkbookRead(encodePayrollWorkbookRead(original), 'archive', { origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })).toEqual(original)
    f.source.workers.find(row => row.id === 'w')!.name = '当前已经改名'
    const reread = await f.archive.workbookArchive({ origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })
    expect(reread.groups).toEqual(original.groups)
    expect(reread.issues).toEqual(original.issues)
    expect((await f.read()).settings?.nextNumber).toBe(129)
    expect(await f.archive.resolveWorkbook(command.commandId, 'p')).toEqual({ state: 'applied', result: saved })
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(1)
  }
  finally { await f.close() }
})

it.each(([
  (copy) => { copy.groups[0].key = '2026-01' },
  (copy) => { copy.groups[0].actualLedger.scope.originalStatementIds = ['unselected-original'] },
  (copy) => { copy.groups[0].entries[0].document.actualAmount = 525 },
  (copy) => { copy.groups[0].entries[0].row.projectId = 'other-project' },
  (copy) => { copy.roster = { id: 'unrelated-roster' } },
  (copy) => { copy.privateWorkers = [{ idCard: 'injected' }] },
  (copy) => { copy.context.sourceVersion = 'different-preview' },
  (copy) => { copy.groups.push(structuredClone(copy.groups[0])) },
]) as Array<(copy: Record<string, any>) => void>)('读取协议拒绝错月分组、跨单实际账、假名册摘要、浮点金额与私密字段注入：输入案例 %#', async (corrupt) => {
  const f = await fixture()
  try {
    const read = await f.preview()
    const wire = encodePayrollWorkbookRead(read)

    const copy = structuredClone(wire)
    corrupt(copy)
    expect(() => decodePayrollWorkbookRead(copy, 'preview', { origin: 'real' }, f.input)).toThrow()
  }
  finally { await f.close() }
})

it('目录同键异文、跨项目和读取权限失效被拒绝；确认未执行后迟到提交不能新增归档', async () => {
  const f = await fixture()
  try {
    const read = await f.preview()
    const command = f.command(read)
    const saved = await f.archive.executeWorkbook(command)
    await expect(f.archive.executeWorkbook({ ...command, input: { ...command.input, mode: 'leader-cycle' } })).rejects.toMatchObject({ problem: { code: 'conflict' } })
    await expect(f.archive.workbookArchive({ origin: 'real' }, { projectId: 'other-project', archiveId: saved.archiveId })).rejects.toMatchObject({ problem: { code: 'not-found' } })
    const late = f.command(await f.preview(), 'late-original')
    expect(await f.archive.resolveWorkbook(late.commandId, 'p')).toEqual({ state: 'not-applied' })
    await expect(f.archive.executeWorkbook(late)).rejects.toMatchObject({ problem: { code: 'conflict' } })
    f.setArchiveSession({ workspaceId: 'work', actorId: 'actor', capabilities: [] })
    await expect(f.archive.workbookArchive({ origin: 'real' }, { projectId: 'p', archiveId: saved.archiveId })).rejects.toMatchObject({ problem: { code: 'forbidden' } })
    expect(await f.db.select('SELECT id FROM payroll_workbook_archives')).toHaveLength(1)
  }
  finally { await f.close() }
})
