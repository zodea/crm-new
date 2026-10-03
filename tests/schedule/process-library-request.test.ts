import { describe, expect, it } from 'vitest'
import { parseProcessLibraryCommand } from '../../server/utils/process-library-request'

function command() {
  return {
    action: 'create-version',
    commandId: 'command',
    workspaceId: 'workspace',
    actorId: 'actor',
    origin: 'real',
    requiredCapability: 'process-library:write',
    baseVersion: 0,
    sourceVersion: null,
    draft: { sourceLibraryId: null, code: 'decoration', name: '标准工序库', description: '独立空白库', tasks: [{ key: 'a', name: '首道工序', durationDays: 3, trade: '木工', color: '#64748b', stageCode: 'stage-a', itemCodes: ['item-a'], predecessorKey: null, predecessorDisabled: false }] },
  }
}
function expectInvalid(value: unknown) {
  expect(() => parseProcessLibraryCommand(value)).toThrow(expect.objectContaining({ problem: expect.objectContaining({ code: 'validation-failed' }) }))
}

describe('工序库公开命令解析', () => {
  function createParseProcessLibraryCommandFixture() {
    const input = command()
    return { input }
  }

  it.each([
    { case: 'input', prepare: ({ input }: ReturnType<typeof createParseProcessLibraryCommandFixture>) => {
      return { input, expected: input } as const
    } },
    { case: 'adjusted', prepare: ({ input }: ReturnType<typeof createParseProcessLibraryCommandFixture>) => {
      const adjusted = { ...input, baseVersion: 3, sourceVersion: '1', draft: { ...input.draft, sourceLibraryId: 'original-version', tasks: [{ ...input.draft.tasks[0]!, predecessorKey: 'previous', predecessorDisabled: true }] } }
      return { input: adjusted, expected: adjusted } as const
    } },
  ])('只复制允许字段，保留工序定义与禁用前置；不把显示名称当身份 / parseProcessLibraryCommand：$case', ({ prepare }) => {
    const fixture = createParseProcessLibraryCommandFixture()
    const { input, expected } = prepare(fixture)
    expect(parseProcessLibraryCommand(input)).toEqual(expected)
  })

  it.each([null, [], 'command', 1, {}])('拒绝非命令载荷 %s', input => expectInvalid(input))

  it.each(['command', 'draft', 'task'] as const)('拒绝 %s 层级多余的业务身份或服务端字段', (level) => {
    const input = command()
    if (level === 'command')
      Object.assign(input, { migrationBatchId: 'forged' })
    if (level === 'draft')
      Object.assign(input.draft, { id: 'existing-version' })
    if (level === 'task')
      Object.assign(input.draft.tasks[0]!, { libraryId: 'other', id: 'forged-task' })
    expectInvalid(input)
  })

  it.each(['commandId', 'workspaceId', 'actorId', 'sourceVersion'] as const)('拒绝 %s 的空白、数字和容器身份', (key) => {
    for (const value of ['', ' ', 1, {}, []])
      expectInvalid({ ...command(), [key]: value })
  })

  it('拒绝来源版本身份、工序编码和前置 key 的容器或空白值', () => {
    for (const value of ['', ' ', 12, {}]) {
      expectInvalid({ ...command(), draft: { ...command().draft, sourceLibraryId: value } })
      for (const key of ['key', 'predecessorKey'])
        expectInvalid({ ...command(), draft: { ...command().draft, tasks: [{ ...command().draft.tasks[0], [key]: value }] } })
    }
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1', null])('拒绝非法 baseVersion %s', (baseVersion) => {
    expectInvalid({ ...command(), baseVersion })
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '2', null])('拒绝非安全整数工期 %s，不能由后续归一静默修正', (durationDays) => {
    expectInvalid({ ...command(), draft: { ...command().draft, tasks: [{ ...command().draft.tasks[0], durationDays }] } })
  })

  it.each(([-1, 0, 366]).map(input => ({ input })))('结构解析保留原始整数，工期范围交由命令服务的领域校验拒绝：输入案例 %#', ({ input: durationDays }) => {
    const input = { ...command(), draft: { ...command().draft, tasks: [{ ...command().draft.tasks[0]!, durationDays }] } }
    expect(parseProcessLibraryCommand(input).draft.tasks[0]!.durationDays).toBe(durationDays)
  })

  it.each([{ action: 'delete' }, { requiredCapability: 'process-library:read' }, { origin: 'other' }])('拒绝未声明的动作、来源与能力 %s', (overrides) => {
    expectInvalid({ ...command(), ...overrides })
  })

  it('拒绝非字符串映射、非法禁用标志和缺失字段', () => {
    for (const overrides of [{ itemCodes: [1] }, { itemCodes: '{}' }, { predecessorDisabled: 1 }, { predecessorDisabled: 'false' }, { stageCode: null }])
      expectInvalid({ ...command(), draft: { ...command().draft, tasks: [{ ...command().draft.tasks[0], ...overrides }] } })
    const missing = command()
    Reflect.deleteProperty(missing.draft.tasks[0]!, 'predecessorKey')
    expectInvalid(missing)
  })

  it('hTTP JSON 中的原型字段注入逐层拒绝，普通文本原样交给领域处理', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      for (const level of ['command', 'draft', 'task']) {
        const input = command()
        const target = level === 'command' ? input : level === 'draft' ? input.draft : input.draft.tasks[0]!
        Object.defineProperty(target, key, { value: { admin: true }, enumerable: true })
        expectInvalid(JSON.parse(JSON.stringify(input)))
      }
    }
    const ordinary = command()
    ordinary.draft.description = '\'); DROP TABLE schedule_process_libraries; --'
    expect(parseProcessLibraryCommand(ordinary).draft.description).toBe(ordinary.draft.description)
    expect(Object.hasOwn(Object.prototype, 'admin')).toBe(false)
  })
})
