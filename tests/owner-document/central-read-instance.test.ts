import { describe, expect, it } from 'vitest'
import { createOwnerCommercialDocumentCommandTestInstance } from '../../server/utils/owner-commercial-document-command-test-instance'
import { OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS } from '../../server/utils/owner-commercial-document-fixtures'
import { createOwnerCommercialDocumentReadTestInstance } from '../../server/utils/owner-commercial-document-read-test-instance'

describe('甲方商务单据中央读取实例', () => {
  it('ready 场景隔离两类正式记录并保留真实空附件', () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({ documents: OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS })
    const read = createOwnerCommercialDocumentReadTestInstance(
      () => ['owner-document:read', 'owner-document:write'],
      commands,
    )

    const changes = read.list('owner_change', { origin: 'real', pageSize: 20 })
    const reports = read.list('owner_report', { origin: 'real', pageSize: 20 })
    expect(changes.items).toHaveLength(2)
    expect(reports.items).toHaveLength(1)
    expect(read.detail('owner_report', 'report-real-323', { origin: 'real' }).files).toEqual([])
  })

  it('empty、forbidden、unavailable 与来源错配保持不同失败语义', () => {
    const commands = createOwnerCommercialDocumentCommandTestInstance({ documents: OWNER_COMMERCIAL_DOCUMENT_READY_RECORDS })
    const read = createOwnerCommercialDocumentReadTestInstance(() => ['owner-document:read', 'demo:read'], commands)

    read.reset('empty')
    expect(read.list('owner_change', { origin: 'real' }).items).toHaveLength(2)
    read.reset('forbidden')
    expect(() => read.list('owner_change', {})).toThrow('无甲方商务单据查看权限')
    read.reset('unavailable')
    expect(() => read.list('owner_change', {})).toThrow('中央读取服务暂时不可用')
    read.reset('ready')
    expect(() => read.detail('owner_change', 'change-real-323', { origin: 'demo', includeDemo: true }))
      .toThrow('来源与地址不匹配')
  })
})
