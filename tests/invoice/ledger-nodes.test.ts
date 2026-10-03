import { describe, expect, it } from 'vitest'
import {
  ledgerNodeFromQuery,
  projectGroupKeyFromNode,
  projectTreeNodeKey,
} from '~/lib/invoice/ledger-nodes'

describe('台账树键与 query 预筛（specs §07：预筛不进页签身份）', () => {
  it('树键与分组键往返一致', () => {
    expect(projectTreeNodeKey('id:p1')).toBe('p:id:p1')
    expect(projectGroupKeyFromNode('__all')).toBeNull()
  })

  it.each([
    { case: '\'p:id:p1\'', input: 'p:id:p1', expected: 'id:p1' },
    { case: '\'p:name:车陂商业大楼\'', input: 'p:name:车陂商业大楼', expected: 'name:车陂商业大楼' },
  ])('树键与分组键往返一致 / projectGroupKeyFromNode：$case', ({ input, expected }) => {
    expect(projectGroupKeyFromNode(input)).toBe(expected)
  })

  it.each([
    { case: '{ project: \'p1\' }', input: { project: 'p1' }, expected: 'p:id:p1' },
    { case: '{ project: [\'p1\', \'p2\'] }', input: { project: ['p1', 'p2'] }, expected: 'p:id:p1' },
  ])('?project=<id> 解析为项目树节点；缺省/非法返回 null（保持「全部」） / ledgerNodeFromQuery：$case', ({ input, expected }) => {
    expect(ledgerNodeFromQuery(input)).toBe(expected)
  })

  it.each([
    { case: '{}', input: {} },
    { case: '{ project: \'\' }', input: { project: '' } },
  ])('?project=<id> 解析为项目树节点；缺省/非法返回 null（保持「全部」） / ledgerNodeFromQuery：$case', ({ input }) => {
    expect(ledgerNodeFromQuery(input)).toBeNull()
  })
})
