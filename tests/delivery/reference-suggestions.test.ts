import { describe, expect, it } from 'vitest'
import { confirmedDeliveryProjectCandidates } from '~/lib/delivery-record/reference-suggestions'

describe('中央送货项目建议来源', () => {
  const projects = [{ id: 'central-p', name: '正式项目', dataOrigin: 'real' as const }]
  const verified = { projectId: 'central-p', rawSiteText: '北门工地', dataOrigin: 'real' as const, archived: true, currentValuesConfirmed: true }

  it('只复用当前同来源且已人工确认的送货工地原文，不把未核对或演示记录当别名', () => {
    expect(confirmedDeliveryProjectCandidates(projects, [verified, { ...verified, rawSiteText: '未核对', currentValuesConfirmed: false }, { ...verified, rawSiteText: '演示工地', dataOrigin: 'demo' }, { ...verified, rawSiteText: '未归档', archived: false }, { ...verified, rawSiteText: '失效项目', projectId: 'local-same-name' }], 'real')).toEqual([{ id: 'central-p', name: '正式项目', aliases: ['北门工地'] }])
  })

  it('规范化后的工地原文指向两个稳定项目时不自动建议任何一方', () => {
    const candidates = confirmedDeliveryProjectCandidates([...projects, { id: 'other-p', name: '另一项目', dataOrigin: 'real' }], [verified, { ...verified, projectId: 'other-p', rawSiteText: '北门 工地' }], 'real')
    expect(candidates).toEqual([
      { id: 'central-p', name: '正式项目', aliases: [] },
      { id: 'other-p', name: '另一项目', aliases: [] },
    ])
  })
})
