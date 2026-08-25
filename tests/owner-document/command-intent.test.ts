import { describe, expect, it } from 'vitest'
import {
  completeOwnerDocumentCommandIntent,
  ownerDocumentCommandId,
} from '~/lib/owner-document/command-intent'

describe('甲方商务单据命令意图', () => {
  it('同一页面同一保存意图在失败重试时复用 commandId', () => {
    const draft = { name: '月度报量', _centralBaseVersion: '1' }
    let sequence = 0
    const createId = () => `command-${++sequence}`
    const payload = { action: 'submit', baseVersion: '1', draft }

    expect(ownerDocumentCommandId(draft, payload, createId)).toBe('command-1')
    expect(ownerDocumentCommandId(draft, payload, createId)).toBe('command-1')
  })

  it('内容、版本或已完成状态变化后生成新的 commandId', () => {
    const draft = { name: '月度报量', _centralBaseVersion: '1' }
    let sequence = 0
    const createId = () => `command-${++sequence}`
    const first = ownerDocumentCommandId(draft, { action: 'save', baseVersion: '1', draft }, createId)
    draft.name = '月度报量（修订）'
    const changed = ownerDocumentCommandId(draft, { action: 'save', baseVersion: '1', draft }, createId)
    completeOwnerDocumentCommandIntent(draft, changed)
    const completed = ownerDocumentCommandId(draft, { action: 'save', baseVersion: '1', draft }, createId)

    expect([first, changed, completed]).toEqual(['command-1', 'command-2', 'command-3'])
  })
})
