import { describe, expect, it } from 'vitest'
import { createReceiptRepository } from '../../app/lib/receipt/repository'
import { createReceiptCommandTestInstance } from '../../server/utils/receipt-command-test-instance'
import { command, references, session } from './fixtures'

describe('收款附件公开正文边界', () => {
  it('响应携带收款、附件和正式来源身份，读取方验证大小与正文哈希', async () => {
    const source = createReceiptCommandTestInstance({ references: () => references })
    const saved = source.execute(command({ attachments: { add: [{ fileName: '凭证.txt', fileSize: 1, payloadBase64: 'YQ==', mimeType: 'text/plain' }] } }), session)
    const fileId = saved.attachmentIds[0]!
    const dto = source.fileContent(saved.id, fileId, session)
    expect(dto).toMatchObject({ receiptId: saved.id, fileId, dataOrigin: 'real', fileSize: 1, sha256: 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb' })
    const repository = createReceiptRepository(async () => dto)
    expect(await repository.fileContent(saved.id, fileId, 'real')).toMatchObject({ payloadBase64: 'YQ==', fileName: '凭证.txt' })
  })

  it('拒绝串收款、串附件、串来源与正文损坏，合法空附件仍可读取', async () => {
    const source = createReceiptCommandTestInstance({ references: () => references })
    const saved = source.execute(command({ attachments: { add: [{ fileName: '空凭证.txt', fileSize: 0, payloadBase64: '' }] } }), session)
    const fileId = saved.attachmentIds[0]!
    const good = source.fileContent(saved.id, fileId, session)
    let response: unknown = good
    const repository = createReceiptRepository(async () => response)
    expect(await repository.fileContent(saved.id, fileId, 'real')).toMatchObject({ payloadBase64: '' })
    for (const patch of [
      { receiptId: 'other' },
      { fileId: 'other' },
      { dataOrigin: 'demo' },
      { fileSize: 1 },
      { payloadBase64: '!!!!' },
      { payloadBase64: 'YQ==' },
      { sha256: '0'.repeat(64) },
      { sha256: null },
    ]) {
      response = { ...good, ...patch }
      await expect(repository.fileContent(saved.id, fileId, 'real')).rejects.toThrow(/附件|响应|数据/)
    }
  })
})
