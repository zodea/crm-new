import type { WorkerSourceRow } from '~/lib/crew-worker/read-contract'
import type { WorkerRosterCommand } from '~/lib/worker-roster/contract'
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { createDbCoordinator } from '~/lib/db/coordinator'
import { EMPTY_WORKER_PRIVATE } from '~/lib/worker-roster/contract'
import { createWorkerRosterArchiveFiles, createWorkerRosterArchiveZip, createWorkerRosterWorkbook } from '~/lib/worker-roster/export'
import { createWorkerRosterService } from '../../server/utils/worker-roster-service'
import { createMigratedMemoryDb } from '../helpers/memory-db'

const closers: Array<() => Promise<void>> = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map(close => close()))
})
async function setup() {
  const db = await createMigratedMemoryDb()
  const coordinator = createDbCoordinator(async () => db)
  closers.push(coordinator.close)
  const session = { workspaceId: 'work', actorId: 'actor', capabilities: ['payroll:read', 'payroll:write', 'worker:write', 'worker:sensitive:read'] }
  const worker: WorkerSourceRow = { id: 'w', dataOrigin: 'real', name: '原姓名', crewId: null, currentProjectId: 'p', phone: '13800000000', idCard: '440000199001010001', gender: '男', hometown: '广东', trade: '铺贴', projectStatus: '在场', entryDate: '2026-08-01', exitDate: null, safetyEducation: true, bankName: '某银行', bankAccount: '6222000000000001', status: 'submitted', updatedAt: '2026-08-01T00:00:00Z' }
  const source = { workers: [worker], projects: [{ id: 'p', name: '项目' }] }
  const statements = [{ id: 'salary', projectId: 'p', status: 'released', formatFamily: 'A', members: [{ workerId: 'w', workerName: '发放时姓名', isLeader: true }, { workerId: 'zero', workerName: '零成员', isLeader: false }], proof: 'frozen-1' }]
  let afterStatements: (() => void) | undefined
  const service = createWorkerRosterService({ session: () => session, source: () => structuredClone(source), transaction: work => coordinator.withTransaction(work), statements: async () => {
    afterStatements?.()
    return structuredClone(statements)
  }, now: () => '2026-09-22T10:00:00Z' })
  let n = 0
  type Fields<T> = T extends WorkerRosterCommand ? Omit<T, 'commandId' | 'workspaceId' | 'actorId' | 'origin'> : never
  const command = (fields: Fields<WorkerRosterCommand>) => ({ ...fields, commandId: `cmd-${++n}`, workspaceId: 'work', actorId: 'actor', origin: 'real' }) as WorkerRosterCommand
  return { db, service, session, source, statements, command, setAfterStatements: (hook: () => void) => afterStatements = hook }
}
describe('工人 owner 私密资料与有日期名册归档', () => {
  it('仅工资读写不能读取实名资料，普通权限不被隐式升级', async () => {
    const f = await setup()
    f.session.capabilities = ['payroll:read', 'payroll:write', 'worker:write']
    await expect(f.service.profile('w')).rejects.toThrow('私密')
    await expect(f.service.preview({ projectId: 'p', statementIds: ['salary'], registeredOn: '2026-09-22' })).rejects.toThrow('私密')
  })
  it('按原冻结成员保留零成员缺口，归档后改名和转组不重写旧版本', async () => {
    const f = await setup()
    const scope = { projectId: 'p', statementIds: ['salary'], registeredOn: '2026-09-22' }
    const read = await f.service.preview(scope)
    expect(read.members.map(m => m.workerId)).toEqual(['w', 'zero'])
    expect(read.members[1]?.diagnostics).toContain('当前工人资料不可用；保留原工资成员')
    const command = f.command({ action: 'archive', scope, sourceVersion: read.sourceVersion })
    const saved = await f.service.execute(command)
    f.source.workers[0]!.name = '后改姓名'
    f.source.workers[0]!.currentProjectId = 'elsewhere'
    expect(await f.service.execute(command)).toEqual(saved)
    const original = await f.service.archive('p', saved.archiveId!)
    expect(original.members[0]?.profile?.name).toBe('原姓名')
    expect(original.members[0]?.payrollNames).toEqual(['发放时姓名'])
    expect(original.evidenceKind).toBe('dated-supplement')
    const next = await f.service.preview(scope)
    expect(next.members[0]?.siteStatus).toBe('unknown')
    const newer = await f.service.execute(f.command({ action: 'archive', scope, sourceVersion: next.sourceVersion }))
    expect(newer.revision).toBe(2)
  })
  it('资料保存幂等、冲突和同键异文保持原版本', async () => {
    const f = await setup()
    const read = await f.service.profile('w')
    const command = f.command({ action: 'save-profile', workerId: 'w', sourceVersion: read.sourceVersion, values: { ...EMPTY_WORKER_PRIVATE, laborContractSigned: false }, uploads: {} })
    const saved = await f.service.execute(command)
    expect(await f.service.execute(command)).toEqual(saved)
    await expect(f.service.execute({ ...command, values: { ...EMPTY_WORKER_PRIVATE, laborContractSigned: true } })).rejects.toThrow('不同')
    await expect(f.service.execute({ ...command, commandId: 'new-key' })).rejects.toThrow('变化')
    expect((await f.service.profile('w')).values.laborContractSigned).toBe(false)
  })
  it('多份工资按稳定身份合并成员，同名异人不合并，原姓名与负责人事实保留', async () => {
    const f = await setup()
    f.statements[0]!.members.forEach(member => member.workerName = '同名工人')
    f.statements.push({ id: 'salary-two', projectId: 'p', status: 'released', formatFamily: 'C2', members: [{ workerId: 'w', workerName: '较晚工资姓名', isLeader: false }], proof: 'frozen-2' })
    const read = await f.service.preview({ projectId: 'p', statementIds: ['salary-two', 'salary'], registeredOn: '2026-09-22' })
    expect(read.members).toHaveLength(2)
    expect(read.members.find(member => member.workerId === 'w')).toMatchObject({ payrollNames: ['同名工人', '较晚工资姓名'], statementIds: ['salary', 'salary-two'], isLeader: true })
    expect(read.members.find(member => member.workerId === 'zero')).toMatchObject({ payrollNames: ['同名工人'], statementIds: ['salary'], isLeader: false, profile: null })
  })
  it('照片版本、原件 owner、摘要与实际 XLSX/ZIP 固定同一版本', async () => {
    const f = await setup()
    const payloadBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    const upload = { fileName: '证件照.png', mimeType: 'image/png', fileSize: Buffer.from(payloadBase64, 'base64').length, payloadBase64 }
    const profile = await f.service.profile('w')
    await f.service.execute(f.command({ action: 'save-profile', workerId: 'w', sourceVersion: profile.sourceVersion, values: { ...EMPTY_WORKER_PRIVATE, laborContractSigned: true, laborContractSignedOn: '2026-08-01' }, uploads: { 'portrait': upload, 'bank-card': { ...upload, fileName: '银行卡.png' } } }))
    const saved = await f.service.profile('w')
    expect(saved.assets).toHaveLength(2)
    const scope = { projectId: 'p', statementIds: ['salary'], registeredOn: '2026-09-22' }
    const preview = await f.service.preview(scope)
    const result = await f.service.execute(f.command({ action: 'archive', scope, sourceVersion: preview.sourceVersion }))
    const original = await f.service.archive('p', result.archiveId!)
    await f.service.execute(f.command({ action: 'save-profile', workerId: 'w', sourceVersion: saved.sourceVersion, values: saved.values, uploads: { portrait: { ...upload, fileName: '后来照片.png' } } }))
    const reopened = await f.service.archive('p', result.archiveId!)
    expect(reopened.members).toEqual(original.members)
    const frozenPhoto = original.members[0]!.photos[0]!
    const bytes = await f.service.file({ projectId: 'p', archiveId: original.id, workerId: 'w', assetId: frozenPhoto.id })
    expect(bytes.payloadBase64).toBe(payloadBase64)
    await expect(f.service.file({ projectId: 'wrong', archiveId: original.id, workerId: 'w', assetId: frozenPhoto.id })).rejects.toThrow('不可读取')
    await expect(f.service.file({ projectId: 'p', archiveId: original.id, workerId: 'zero', assetId: frozenPhoto.id })).rejects.toThrow('范围')
    const newPhoto = (await f.service.profile('w')).values.portraitId!
    await expect(f.service.file({ projectId: 'p', archiveId: original.id, workerId: 'w', assetId: newPhoto })).rejects.toThrow('范围')
    const workbook = createWorkerRosterWorkbook(original)
    const read = XLSX.read(workbook.data, { type: 'array' })
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(read.Sheets['实名名册']!)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ '身份证号': '440000199001010001', '银行账号': '6222000000000001', '劳动合同签订情况': '已签订', '姓名（登记时）': '原姓名' })
    expect(rows[0]!['证件照路径']).toBe('photos/member-1/photo-1.png')
    expect(rows[1]!['姓名（原工资）']).toBe('零成员')
    const files = await createWorkerRosterArchiveFiles(original, input => f.service.file(input))
    expect(files.filter(file => file.path.startsWith('photos/'))).toHaveLength(2)
    expect(files.find(file => file.path === rows[0]!['证件照路径'])!.data).toEqual(new Uint8Array(Buffer.from(payloadBase64, 'base64')))
    const zip = await createWorkerRosterArchiveZip(original, input => f.service.file(input))
    expect(new DataView(zip.buffer, zip.byteOffset).getUint32(0, true)).toBe(0x04034B50)
    f.session.capabilities = f.session.capabilities.filter(capability => capability !== 'worker:sensitive:read')
    await expect(f.service.archive('p', original.id)).rejects.toThrow('私密')
    await expect(f.service.file({ projectId: 'p', archiveId: original.id, workerId: 'w', assetId: frozenPhoto.id })).rejects.toThrow('私密')
  })
  it('错误照片回滚整笔且不可绑定另一工人的照片', async () => {
    const f = await setup()
    const read = await f.service.profile('w')
    const values = { ...EMPTY_WORKER_PRIVATE }
    await expect(f.service.execute(f.command({ action: 'save-profile', workerId: 'w', sourceVersion: read.sourceVersion, values, uploads: { portrait: { fileName: '假.png', mimeType: 'image/png', fileSize: 3, payloadBase64: 'YWJj' } } }))).rejects.toThrow('不一致')
    expect((await f.service.profile('w')).revision).toBe(0)
    expect(await f.db.select('SELECT * FROM worker_roster_assets')).toHaveLength(0)
    await expect(f.service.execute(f.command({ action: 'save-profile', workerId: 'w', sourceVersion: read.sourceVersion, values: { ...values, portraitId: 'other-person-photo' }, uploads: {} }))).rejects.toThrow('不属于')
  })
  it('长编码迁入身份可归档，照片路径为短文件名且与实际工作簿一致', async () => {
    const f = await setup()
    const workerId = `worker:${encodeURIComponent('旧 工人'.repeat(18))}`
    const statementId = `payroll:${encodeURIComponent('旧 工资'.repeat(18))}`
    f.source.workers[0]!.id = workerId
    f.statements[0]!.id = statementId
    f.statements[0]!.members[0]!.workerId = workerId
    const profile = await f.service.profile(workerId)
    const payloadBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    await f.service.execute(f.command({ action: 'save-profile', workerId, sourceVersion: profile.sourceVersion, values: EMPTY_WORKER_PRIVATE, uploads: { portrait: { fileName: '照片.png', mimeType: 'image/png', fileSize: Buffer.from(payloadBase64, 'base64').length, payloadBase64 } } }))
    const scope = { projectId: 'p', statementIds: [statementId], registeredOn: '2026-09-22' }
    const preview = await f.service.preview(scope)
    const saved = await f.service.execute(f.command({ action: 'archive', scope, sourceVersion: preview.sourceVersion }))
    const archive = await f.service.archive('p', saved.archiveId!)
    const files = await createWorkerRosterArchiveFiles(archive, input => f.service.file(input))
    const photo = files.find(file => file.path.startsWith('photos/'))!
    expect(photo.path).toBe('photos/member-1/photo-1.png')
    expect(Buffer.from(photo.data).toString('base64')).toBe(payloadBase64)
    const book = XLSX.read(files[0]!.data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(book.Sheets['实名名册']!)[0]).toMatchObject({ 工人身份: workerId, 工资身份: statementId, 证件照路径: photo.path })
  })
  it('结果核对取消尚未到达的请求，冷恢复不需要浏览器保存私密正文', async () => {
    const f = await setup()
    const read = await f.service.profile('w')
    const command = f.command({ action: 'save-profile', workerId: 'w', sourceVersion: read.sourceVersion, values: EMPTY_WORKER_PRIVATE, uploads: {} })
    expect(await f.service.resolve(command.commandId, command.action)).toEqual({ state: 'not-applied' })
    await expect(f.service.execute(command)).rejects.toThrow('不同')
    expect((await f.service.profile('w')).revision).toBe(0)
    const appliedCommand = { ...command, commandId: 'applied-command' }
    const applied = await f.service.execute(appliedCommand)
    expect(await f.service.resolve(appliedCommand.commandId, appliedCommand.action)).toEqual({ state: 'applied', result: applied })
  })
  it('陈旧资料、跨项目、非已发、额外字段和无效日期均不创建归档', async () => {
    const f = await setup()
    const scope = { projectId: 'p', statementIds: ['salary'], registeredOn: '2026-09-22' }
    const read = await f.service.preview(scope)
    f.source.workers[0]!.bankAccount = 'new-bank'
    await expect(f.service.execute(f.command({ action: 'archive', scope, sourceVersion: read.sourceVersion }))).rejects.toThrow('变化')
    await expect(f.service.preview({ ...scope, workerIds: ['other'] } as typeof scope)).rejects.toThrow('无效')
    f.statements[0]!.projectId = 'other'
    await expect(f.service.preview(scope)).rejects.toThrow('同项目')
    f.statements[0]!.projectId = 'p'
    f.statements[0]!.status = 'checked'
    await expect(f.service.preview(scope)).rejects.toThrow('已发')
    f.statements[0]!.status = 'released'
    f.source.workers[0]!.entryDate = '2026-02-31'
    expect((await f.service.preview(scope)).members[0]!.siteStatus).toBe('unknown')
    expect(await f.db.select('SELECT * FROM worker_roster_archives')).toHaveLength(0)
  })
  it('读取中途撤销权限或切换身份时，已构建归档及回执一并回滚', async () => {
    const f = await setup()
    const scope = { projectId: 'p', statementIds: ['salary'], registeredOn: '2026-09-22' }
    const preview = await f.service.preview(scope)
    f.setAfterStatements(() => {
      f.session.actorId = 'changed-actor'
    })
    await expect(f.service.execute(f.command({ action: 'archive', scope, sourceVersion: preview.sourceVersion }))).rejects.toThrow('身份')
    expect(await f.db.select('SELECT * FROM worker_roster_archives')).toHaveLength(0)
    expect(await f.db.select('SELECT * FROM worker_roster_receipts')).toHaveLength(0)
    f.setAfterStatements(() => {
      f.session.capabilities = []
    })
    await expect(f.service.preview(scope)).rejects.toThrow('私密')
  })
  it.each((['worker_roster_assets', 'worker_roster_profile_versions', 'worker_roster_receipts', 'file_refs', 'file_payloads', 'operation_logs']).map(input => ({ input })))('插入版本失败时上传原件、正文、回执和日志不留下半份数据：输入案例 %#', async ({ input: table }) => {
    const f = await setup()
    const profile = await f.service.profile('w')
    await f.db.execute('CREATE TRIGGER reject_profile BEFORE INSERT ON worker_roster_profile_versions BEGIN SELECT RAISE(ABORT,\'roster test failure\'); END')
    const payloadBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
    await expect(f.service.execute(f.command({ action: 'save-profile', workerId: 'w', sourceVersion: profile.sourceVersion, values: EMPTY_WORKER_PRIVATE, uploads: { portrait: { fileName: '证件照.png', mimeType: 'image/png', fileSize: Buffer.from(payloadBase64, 'base64').length, payloadBase64 } } }))).rejects.toThrow('roster test failure')
    expect(await f.db.select(`SELECT * FROM ${table}`)).toHaveLength(0)
  })
  it('损坏的冻结统计不能以健康归档返回或导出', async () => {
    const f = await setup()
    const scope = { projectId: 'p', statementIds: ['salary'], registeredOn: '2026-09-22' }
    const preview = await f.service.preview(scope)
    const saved = await f.service.execute(f.command({ action: 'archive', scope, sourceVersion: preview.sourceVersion }))
    const original = await f.service.archive('p', saved.archiveId!)
    original.counts.present = 999
    await f.db.execute('UPDATE worker_roster_archives SET snapshot_json=? WHERE id=?', [JSON.stringify(original), original.id])
    await expect(f.service.archive('p', original.id)).rejects.toThrow('损坏')
    expect(() => createWorkerRosterWorkbook(original)).toThrow('不完整')
  })
})
