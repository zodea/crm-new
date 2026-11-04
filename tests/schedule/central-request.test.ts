import { describe, expect, it } from 'vitest'
import { parseScheduleCommand, parseScheduleRead } from '../../server/utils/schedule-request'

const command = { commandId: 'c', workspaceId: 'w', actorId: 'a', origin: 'real', requiredCapability: 'schedule:write', projectId: 'p', sourceVersion: 'v', action: { kind: 'set-baseline' } }
const invalidCommand = { problem: { code: 'validation-failed', message: '排程身份、日期或命令字段无效' } }
function commandFailure(input: unknown): unknown {
  try {
    parseScheduleCommand(input)
  }
  catch (cause) {
    return cause
  }
  return undefined
}
describe('中央 WBS 请求边界', () => {
  it('读取保留明确来源与用户运行日，拒绝伪造月日和演示写入', () => {
    expect(parseScheduleRead({ projectId: 'p', origin: 'real', today: '2026-09-12' })).toMatchObject({ today: '2026-09-12' })
    expect(() => parseScheduleRead({ projectId: 'p', origin: 'real', today: '2026-02-30' })).toThrow('无效日期：2026-02-30')
    expect(commandFailure({ ...command, origin: 'demo' })).toMatchObject(invalidCommand)
  })
  it.each([
    { case: '越权顶层字段', input: { ...command, admin: true } },
    { case: '合同绑定缺少必填字段', input: { ...command, action: { kind: 'bind-contract' } } },
    { case: '字符串进度', input: { ...command, action: { kind: 'update-task', taskId: 't', patch: { manualProgress: '0.5' } } } },
    { case: '重复楼层', input: { ...command, action: { kind: 'update-floors', taskId: 't', patches: [{ id: 'f', plannedStart: '2026-09-01', plannedFinish: '2026-09-02' }, { id: 'f', plannedStart: '2026-09-01', plannedFinish: '2026-09-02' }] } } },
  ])('拒绝 $case', ({ input }) => {
    expect(commandFailure(input)).toMatchObject(invalidCommand)
  })
})
