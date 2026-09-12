import { describe, expect, it } from 'vitest'
import { parseScheduleCommand, parseScheduleRead } from '../../server/utils/schedule-request'

const command = { commandId: 'c', workspaceId: 'w', actorId: 'a', origin: 'real', requiredCapability: 'schedule:write', projectId: 'p', sourceVersion: 'v', action: { kind: 'set-baseline' } }
describe('中央 WBS 请求边界', () => {
  it('读取保留明确来源与用户运行日，拒绝伪造月日和演示写入', () => {
    expect(parseScheduleRead({ projectId: 'p', origin: 'real', today: '2026-09-12' })).toMatchObject({ today: '2026-09-12' })
    expect(() => parseScheduleRead({ projectId: 'p', origin: 'real', today: '2026-02-30' })).toThrow()
    expect(() => parseScheduleCommand({ ...command, origin: 'demo' })).toThrow()
  })
  it('不接受任意动作、越权顶层字段、字符串进度或重复楼层', () => {
    expect(() => parseScheduleCommand({ ...command, admin: true })).toThrow()
    expect(() => parseScheduleCommand({ ...command, action: { kind: 'bind-contract' } })).toThrow()
    expect(() => parseScheduleCommand({ ...command, action: { kind: 'update-task', taskId: 't', patch: { manualProgress: '0.5' } } })).toThrow()
    expect(() => parseScheduleCommand({ ...command, action: { kind: 'update-floors', taskId: 't', patches: [{ id: 'f', plannedStart: '2026-09-01', plannedFinish: '2026-09-02' }, { id: 'f', plannedStart: '2026-09-01', plannedFinish: '2026-09-02' }] } })).toThrow()
  })
})
