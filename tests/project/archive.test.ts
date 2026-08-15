import type { ProjectArchiveSnapshot } from '~/lib/project/archive'
import { describe, expect, it, vi } from 'vitest'
import {
  archivePath,
  createProjectArchiveZip,
  createZip,
  loadProjectArchiveSnapshot,
  sanitizeSegment,
  selectedArchiveFiles,
} from '~/lib/project/archive'

const select = vi.hoisted(() => vi.fn())

vi.mock('~/lib/db/connection', () => ({ select }))

function snapshot(): ProjectArchiveSnapshot {
  const normal = {
    id: 'file-normal',
    ownerType: 'project',
    ownerId: 'project-1',
    fileName: '立项:批复.pdf',
    fileSize: 4,
    mimeType: 'application/pdf',
    category: '立项',
    uploader: '资料员',
    uploadedAt: '2026-08-08T08:00:00.000Z',
    sourceLabel: '测试项目',
    folderPath: ['01_项目信息与工程档案', '01_项目基本信息'],
    archivePath: '01_项目信息与工程档案/01_项目基本信息/立项-批复.pdf',
    sensitivity: 'normal' as const,
    hasPayload: true,
  }
  const sensitive = {
    ...normal,
    id: 'file-sensitive',
    fileName: '个人银行卡.pdf',
    category: '银行卡',
    sensitivity: 'sensitive' as const,
    archivePath: '03_班组与工人/木工/张三_worker-1/01_个人资料/个人银行卡.pdf',
  }
  const missing = {
    ...normal,
    id: 'file-missing',
    fileName: '历史原件.pdf',
    hasPayload: false,
    missingReason: '数据库只有附件元数据，未保存原件正文',
    archivePath: '01_项目信息与工程档案/02_项目立项/01_立项/历史原件.pdf',
  }
  return {
    project: {
      id: 'project-1',
      name: '测试项目',
      code: 'P-001',
      status: '施工中',
      manager: '项目经理',
    },
    folders: [
      { key: 'project', path: ['01_项目信息与工程档案'], label: '项目档案' },
    ],
    files: [normal, sensitive, missing],
    tree: [],
  }
}

function zipLocalNames(data: Uint8Array): string[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  const decoder = new TextDecoder()
  const names: string[] = []
  let offset = 0
  while (offset + 4 <= data.length && view.getUint32(offset, true) === 0x04034B50) {
    const nameLength = view.getUint16(offset + 26, true)
    const extraLength = view.getUint16(offset + 28, true)
    const size = view.getUint32(offset + 18, true)
    names.push(decoder.decode(data.subarray(offset + 30, offset + 30 + nameLength)))
    offset += 30 + nameLength + extraLength + size
  }
  return names
}

describe('项目档案包导出（Issue #248）', () => {
  it('清洗目录段并保持路径不允许穿越或覆盖保留名', () => {
    expect(sanitizeSegment('CON')).toBe('_CON')
    expect(archivePath('项目', '../附件:原件.pdf')).toBe('项目/未命名/附件-原件.pdf')
  })

  it('核心默认选择只包含有原件正文的非敏感文件', () => {
    const current = snapshot()
    const selected = new Set(current.files
      .filter(file => file.sensitivity === 'normal' && file.hasPayload)
      .map(file => file.id))
    expect(selectedArchiveFiles(current, selected).map(file => file.id)).toEqual(['file-normal'])
  })

  it('目录预览把档案说明与清单展示为 ZIP 根级目录', async () => {
    select.mockReset()
    select.mockImplementation(async (sql: string) => sql.includes('FROM "projects"')
      ? [{ id: 'project-1', name: '测试项目', code: 'P-001', status: '施工中', manager: '项目经理' }]
      : [])

    const current = await loadProjectArchiveSnapshot('project-1')
    const manifestFolder = current.folders.find(folder => folder.key === 'project-manifest')
    const projectRoot = current.tree.find(node => node.label === '01_项目信息与工程档案')

    expect(manifestFolder?.path).toEqual(['00_档案说明与清单'])
    expect(current.tree).toContainEqual(expect.objectContaining({
      key: 'folder:00_档案说明与清单',
      label: '00_档案说明与清单',
      kind: 'folder',
    }))
    expect(projectRoot?.children?.some(node => node.label === '00_档案说明与清单')).toBe(false)
  })

  it('zip 使用稳定排序，并把目录、清单和缺失原件留痕写入包内', async () => {
    const current = snapshot()
    const selected = new Set(['file-normal', 'file-sensitive', 'file-missing'])
    const result = await createProjectArchiveZip(current, {
      selectedFileIds: selected,
      exportedAt: '2026-08-08T09:00:00.000Z',
      loadContent: async file => file.id === 'file-missing' ? null : new TextEncoder().encode(file.id),
    })
    const names = zipLocalNames(result.data)
    expect(result.exportedFiles.map(file => file.id)).toEqual(['file-normal'])
    expect(result.missingFiles.map(file => file.id)).toEqual(['file-missing'])
    expect(names).toContain('01_项目信息与工程档案/01_项目基本信息/立项-批复.pdf')
    expect(names).toContain('00_档案说明与清单/导出说明.txt')
    expect(names).toContain('00_档案说明与清单/文件清单.csv')
    expect(names).toContain('00_档案说明与清单/项目档案目录.xlsx')
    expect(names).toContain('00_档案说明与清单/文件清单.xlsx')
    expect(names.some(name => name.startsWith('01_项目信息与工程档案/00_档案说明与清单/'))).toBe(false)
    expect(new TextDecoder().decode(result.data)).toContain('原件导出权限待配置')
  })

  it('同一输入生成的 zip 字节序列稳定', () => {
    const first = createZip([
      { path: 'b.txt', data: new TextEncoder().encode('b') },
      { path: 'a.txt', data: new TextEncoder().encode('a') },
    ])
    const second = createZip([
      { path: 'a.txt', data: new TextEncoder().encode('a') },
      { path: 'b.txt', data: new TextEncoder().encode('b') },
    ])
    expect([...first]).toEqual([...second])
  })
})
