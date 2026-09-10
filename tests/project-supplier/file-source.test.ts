import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { PROJECT_SUPPLIER_WRITE_CAPABILITY } from '~/lib/project-supplier/command-contract'
import { createProjectSupplierCommandTestInstance } from '../../server/utils/project-supplier-command-test-instance'
import { cooperationPdfFixture } from './pdf-fixture'

describe('项目合作中央正文源', () => {
  it('中央导入保存完整多页 PDF 和摘要，元数据读取不携带正文，同 ID 的其他来源或会话不回落', async () => {
    const source = createProjectSupplierCommandTestInstance({ createId: prefix => `${prefix}-438` })
    const bytes = cooperationPdfFixture()
    const payloadBase64 = Buffer.from(bytes).toString('base64')
    const session = { workspaceId: 'w-438', actorId: 'a-438', capabilities: [PROJECT_SUPPLIER_WRITE_CAPABILITY] }
    await source.execute({
      projectId: 'project-438',
      workspaceId: session.workspaceId,
      actorId: session.actorId,
      requiredCapability: PROJECT_SUPPLIER_WRITE_CAPABILITY,
      commandId: 'import-438',
      baseVersion: '0',
      groups: [{ supplierId: 'supplier-438', supplierName: '中央分供方', files: [{
        fileName: '原始两页.pdf',
        fileSize: bytes.byteLength,
        mimeType: 'application/pdf',
        category: '合同',
        payloadBase64,
      }] }],
    }, session, { project: { id: 'project-438', name: '项目' }, suppliers: [{ id: 'supplier-438', name: '中央分供方' }], existingRelationships: [] }, 'session-438')

    expect(source.filePayload('file-438', 'real', 'session-438')).toEqual({
      payloadBase64,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
    expect(source.filePayload('file-438', 'demo', 'session-438')).toBeNull()
    expect(source.filePayload('file-438', 'real', 'other-session')).toBeNull()
    expect(source.rows('session-438').files[0]).toMatchObject({ hasPayload: true })
    expect(JSON.stringify(source.rows('session-438'))).not.toContain(payloadBase64)

    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await getDocument({ data: new Uint8Array(Buffer.from(source.filePayload('file-438', 'real', 'session-438')!.payloadBase64, 'base64')), useSystemFonts: true }).promise
    try {
      expect(pdf.numPages).toBe(2)
      const text = []
      for (let number = 1; number <= pdf.numPages; number++) {
        const page = await pdf.getPage(number)
        const content = await page.getTextContent()
        text.push(content.items.map(item => 'str' in item ? item.str : '').join(''))
      }
      expect(text).toEqual(['Original page 1', 'Original page 2'])
    }
    finally {
      await pdf.destroy()
    }
  })
})
