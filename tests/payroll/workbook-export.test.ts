import type { PayrollActualLedgerRead } from '~/lib/payroll/central-actual-contract'
import type { PayrollStatementRow } from '~/lib/payroll/central-contract'
import type { PayrollWorkbookArchive } from '~/lib/payroll/central-workbook-contract'
import type { WorkerRosterArchive, WorkerRosterFile } from '~/lib/worker-roster/contract'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import * as XLSX from 'xlsx'
import { assertPayrollWorkbookRoster, createPayrollSavedArchive, createPayrollSavedArchiveFiles, createPayrollSavedWorkbook } from '~/lib/payroll/workbook-export'
import { EMPTY_WORKER_PRIVATE } from '~/lib/worker-roster/contract'
import { rosterCanonical } from '~/lib/worker-roster/validation'
import { payrollUiDocument } from '../helpers/payroll-a-ui-fixture'

function fixture(mode: PayrollWorkbookArchive['input']['mode'] = 'leader-cycle') {
  const context = { workspaceId: 'work', actorId: 'actor', origin: 'real' as const, sourceVersion: 'v1', capabilities: ['payroll:read', 'payroll:write', 'worker:sensitive:read'], readonly: false }
  const document = payrollUiDocument()
  const row = { id: document.id, projectId: document.projectId, leaderWorkerId: 'worker', formatFamily: 'A', month: document.month, book: { bookPurpose: 'ordinary', managementBookId: null } } as PayrollStatementRow
  const ledger: PayrollActualLedgerRead = { context, scope: { projectId: document.projectId, originalStatementIds: [document.id] }, sourceVersion: 'actual-v1', status: 'complete', rows: [], netAmount: { state: 'known', value: 280, knownValue: 280, reasons: [] }, diagnostics: [] }
  const payloadBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII='
  const bytes = Uint8Array.from(atob(payloadBase64), character => character.charCodeAt(0))
  const asset = { id: 'photo:encoded%20identity', workerId: 'worker', fileName: '原证件照.png', mimeType: 'image/png', fileSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), createdAt: '2026-09-22T10:00:00Z', state: 'available' as const, legacyCategory: null }
  const roster: WorkerRosterArchive = {
    context,
    id: 'roster-1',
    version: 2,
    createdAt: '2026-09-22T10:00:00Z',
    createdBy: 'actor',
    evidenceKind: 'dated-supplement',
    scope: { projectId: document.projectId, statementIds: [document.id], registeredOn: '2026-09-22' },
    projectName: '冻结项目',
    sourceVersion: 'roster-v2',
    diagnostics: ['零成员资料缺失'],
    counts: { present: 1, left: 0, notEntered: 0, unknown: 1 },
    members: [
      { workerId: 'worker', payrollNames: ['同名工人'], statementIds: [document.id], isLeader: true, profile: { id: 'worker', dataOrigin: 'real', name: '同名工人', crewId: null, currentProjectId: document.projectId, phone: '13800000000', idCard: '440000199001010001', gender: '男', hometown: '广东', trade: '铺贴', projectStatus: '在场', entryDate: '2026-08-01', exitDate: null, bankName: '原银行', bankAccount: '6222000000000001', status: 'submitted', updatedAt: '2026-09-22T10:00:00Z' }, sourceVersion: 'worker-v1', revision: 1, values: { ...EMPTY_WORKER_PRIVATE, portraitId: asset.id }, photos: [{ ...asset, purpose: 'portrait' }], siteStatus: 'present', diagnostics: ['未记录银行卡照片'] },
      { workerId: 'zero', payrollNames: ['同名工人'], statementIds: [document.id], isLeader: false, profile: null, sourceVersion: null, revision: null, values: EMPTY_WORKER_PRIVATE, photos: [], siteStatus: 'unknown', diagnostics: ['原零分配成员，当前资料未记录'] },
    ],
  }
  const { context: _context, ...body } = roster
  const archive: PayrollWorkbookArchive = {
    context,
    schemaVersion: 1,
    id: 'directory-1',
    version: 1,
    createdAt: '2026-09-22T11:00:00Z',
    createdBy: 'actor',
    sourceVersion: 'archive-v1',
    input: { projectId: document.projectId, mode, statementIds: [document.id], rosterArchiveId: roster.id },
    projectName: '冻结项目',
    groups: [{ key: mode === 'leader-cycle' ? 'one-book' : document.month, label: '项目-同名负责人', entries: [{ row, document }], actualLedger: ledger }],
    gaps: [],
    deliveryGaps: [{ kind: 'roster', statementId: null, reason: '名册保留资料缺口' }],
    issues: [{ id: 'issue-1', projectId: document.projectId, statementId: document.id, formatFamily: 'A', number: '1001', documentHash: 'b'.repeat(64), issuedAt: '2026-09-22T10:30:00Z', operatorId: 'actor', commandId: 'issue-command' }],
    rosterRef: { id: roster.id, version: roster.version, registeredOn: roster.scope.registeredOn, sourceVersion: roster.sourceVersion, contentHash: createHash('sha256').update(rosterCanonical(body)).digest('hex') },
    manifestHash: 'a'.repeat(64),
    completeness: 'partial',
  }
  const file: WorkerRosterFile = { asset, payloadBase64 }
  const readers = { archive: vi.fn(async () => structuredClone(archive)), roster: { archive: vi.fn(async () => structuredClone(roster)), file: vi.fn(async () => structuredClone(file)) } }
  return { archive, roster, readers, bytes, file }
}

describe('固定工资目录的真实文件组合', () => {
  it.each(['leader-cycle', 'project-month'] as const)('从 %s 的固定编号名册生成实际工作簿及照片，零成员与同名异人保留', async (mode) => {
    const f = fixture(mode)
    const files = await createPayrollSavedArchiveFiles(f.archive, true, f.readers)
    const wageFile = files.find(file => file.path.endsWith('.xlsx') && file.path !== '01-实名名册.xlsx')!
    const workbook = XLSX.read(wageFile.data, { type: 'array' })
    expect(XLSX.utils.sheet_to_json(workbook.Sheets.目录!)).toEqual([expect.objectContaining({ 正式编号: '1001', 名册版本: 2 })])
    const people = XLSX.utils.sheet_to_json(workbook.Sheets.实名名册!)
    expect(people).toHaveLength(2)
    expect(people[0]).toMatchObject({ 工人身份: 'worker', 身份证号: '440000199001010001', 证件照路径: `${mode === 'project-month' ? '../' : ''}photos/member-1/photo-1.png` })
    expect(people[1]).toMatchObject({ '工人身份': 'zero', '姓名（原工资）': '同名工人' })
    expect(files.find(file => file.path === 'photos/member-1/photo-1.png')!.data).toEqual(f.bytes)
    const privateIndex = JSON.parse(new TextDecoder().decode(files.find(file => file.path === '01-私密附件目录.json')!.data))
    expect(privateIndex.photos[0]).toMatchObject({ assetId: f.file.asset.id, sha256: f.file.asset.sha256, path: 'photos/member-1/photo-1.png' })
    const output = await createPayrollSavedArchive(f.archive, true, f.readers)
    expect(new DataView((output.data as Uint8Array).buffer).getUint32(0, true)).toBe(0x04034B50)
    expect(f.readers.roster.archive).toHaveBeenCalledTimes(4)
  })

  it('长项目和负责人名称的实际ZIP工资条目保留完整摘要与xlsx后缀', async () => {
    const f = fixture()
    f.archive.groups[0]!.label = '很长的项目与同名负责人'.repeat(30)
    const output = await createPayrollSavedArchive(f.archive, false, f.readers)
    const bytes = output.data as Uint8Array
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const names: string[] = []
    for (let offset = 0; offset + 30 < bytes.length && view.getUint32(offset, true) === 0x04034B50;) {
      const size = view.getUint32(offset + 18, true)
      const length = view.getUint16(offset + 26, true)
      names.push(new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + length)))
      offset += 30 + length + view.getUint16(offset + 28, true) + size
    }
    expect(names.filter(name => name.endsWith('.xlsx'))).toHaveLength(1)
    expect(names.find(name => name.endsWith('.xlsx'))).toContain(f.archive.manifestHash)
  })

  it('迁入旧目录接受服务端严格证明的原名册摘要，保留全部范围检查并说明原摘要', async () => {
    const f = fixture()
    const originalHash = f.archive.rosterRef!.contentHash
    f.roster.id = 'mapped-roster'
    f.roster.migration = { originalId: 'roster-1', originalContentHash: originalHash }
    f.archive.rosterRef!.id = f.roster.id
    f.archive.input.rosterArchiveId = f.roster.id
    f.archive.migration = { originalId: 'old-directory', originalContentHash: f.archive.manifestHash }
    f.readers.roster.archive.mockImplementation(async () => structuredClone(f.roster))
    f.readers.archive.mockImplementation(async () => structuredClone(f.archive))
    const files = await createPayrollSavedArchiveFiles(f.archive, true, f.readers)
    const manifest = JSON.parse(new TextDecoder().decode(files[0]!.data))
    expect(manifest.manifestHash).toBe(f.archive.manifestHash)
    expect(manifest.migrationNotice).toContain('原始归档')
    const wrongScope = structuredClone(f.roster)
    wrongScope.scope.projectId = 'another-project'
    await expect(assertPayrollWorkbookRoster(f.archive, wrongScope)).rejects.toThrow()
    const invalidProof = structuredClone(f.roster)
    invalidProof.migration!.originalContentHash = 'invalid'
    await expect(assertPayrollWorkbookRoster(f.archive, invalidProof)).rejects.toThrow()
    const unproven = structuredClone(f.roster)
    delete unproven.migration
    await expect(assertPayrollWorkbookRoster(f.archive, unproven)).rejects.toThrow('摘要')
  })

  it('普通工资下载完全不读工人私密接口，公开目录和 XLSX 明确未包含附件', async () => {
    const f = fixture()
    f.archive.context.capabilities = ['payroll:read']
    const output = createPayrollSavedWorkbook(f.archive)
    const book = XLSX.read(output.data, { type: 'array' })
    expect(book.SheetNames).not.toContain('实名名册')
    expect(XLSX.utils.sheet_to_json(book.Sheets.交付缺口!)).toContainEqual(expect.objectContaining({ 缺口: expect.stringContaining('未包含实名名册') }))
    const files = await createPayrollSavedArchiveFiles(f.archive, false, f.readers)
    expect(files.some(file => file.path.includes('私密') || file.path.startsWith('photos/'))).toBe(false)
    expect(new TextDecoder().decode(files[0]!.data)).not.toContain('440000199001010001')
    expect(f.readers.roster.archive).not.toHaveBeenCalled()
    expect(f.readers.roster.file).not.toHaveBeenCalled()
  })

  it('版本正文、工资范围、照片正文或读取末端撤权均停止整包，不输出看似完整的文件', async () => {
    const f = fixture()
    const changed = structuredClone(f.roster)
    changed.members[0]!.profile!.bankAccount = '后改账号'
    await expect(assertPayrollWorkbookRoster(f.archive, changed)).rejects.toThrow('摘要')
    changed.scope.statementIds.push('another-salary')
    await expect(assertPayrollWorkbookRoster(f.archive, changed)).rejects.toThrow('范围')
    f.readers.roster.file.mockResolvedValue({ ...f.file, payloadBase64: btoa('bad-content') })
    await expect(createPayrollSavedArchiveFiles(f.archive, true, f.readers)).rejects.toThrow('摘要')
    f.readers.roster.file.mockResolvedValue(f.file)
    f.readers.roster.archive.mockResolvedValueOnce(f.roster).mockResolvedValueOnce({ ...f.roster, context: { ...f.roster.context, capabilities: ['payroll:read'] } })
    await expect(createPayrollSavedArchiveFiles(f.archive, true, f.readers)).rejects.toThrow('权限')
    f.readers.roster.archive.mockResolvedValue(f.roster)
    f.readers.archive.mockResolvedValue({ ...f.archive, context: { ...f.archive.context, capabilities: ['payroll:read'] } })
    await expect(createPayrollSavedArchiveFiles(f.archive, true, f.readers)).rejects.toThrow('私密')
    f.readers.archive.mockResolvedValue({ ...f.archive, context: { ...f.archive.context, capabilities: [] } })
    await expect(createPayrollSavedArchiveFiles(f.archive, true, f.readers)).rejects.toThrow('权限')
  })
})
