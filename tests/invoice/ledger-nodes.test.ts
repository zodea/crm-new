import { describe, expect, it } from 'vitest'
import {
  ledgerNodeFromQuery,
  projectGroupKeyFromNode,
  projectTreeNodeKey,
} from '~/lib/invoice/ledger-nodes'

describe('台账树键与 query 预筛（specs §07：预筛不进页签身份）', () => {
  it('树键与分组键往返一致', () => {
    expect(projectTreeNodeKey('id:p1')).toBe('p:id:p1')
    expect(projectGroupKeyFromNode('p:id:p1')).toBe('id:p1')
    expect(projectGroupKeyFromNode('p:name:车陂商业大楼')).toBe('name:车陂商业大楼')
    expect(projectGroupKeyFromNode('__all')).toBeNull()
  })

  it('?project=<id> 解析为项目树节点；缺省/非法返回 null（保持「全部」）', () => {
    expect(ledgerNodeFromQuery({ project: 'p1' })).toBe('p:id:p1')
    expect(ledgerNodeFromQuery({})).toBeNull()
    expect(ledgerNodeFromQuery({ project: '' })).toBeNull()
    expect(ledgerNodeFromQuery({ project: ['p1', 'p2'] })).toBe('p:id:p1')
  })
})
