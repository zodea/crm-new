import { describe, expect, it } from 'vitest'
import {
  canonicalCredentialCategory,
  credentialExpiryState,
  defaultCredentialRequirement,
  hasManualCredentialReviewProof,
  resolveAutomaticCredentialStatus,
  shanghaiBusinessDate,
} from '~/lib/supplier/credentials'

const NOW = new Date('2026-07-30T12:00:00.000Z')

describe('分供方证照规则', () => {
  it('把银行与品牌历史名称归一为稳定业务类别', () => {
    for (const alias of [
      '银行开户许可证',
      '开户许可证',
      '基本存款账户信息',
      '基本存款账户信息表',
    ]) {
      expect(canonicalCredentialCategory(alias)).toBe('银行账户资料')
    }
    expect(canonicalCredentialCategory('品牌授权证明')).toBe('品牌授权书')
    expect(canonicalCredentialCategory('品牌授权书')).toBe('品牌授权书')
  })

  it('默认要求区分必需、条件不适用与可选资料', () => {
    expect(defaultCredentialRequirement('营业执照')).toBe('required')
    expect(defaultCredentialRequirement('基本存款账户信息')).toBe('required')
    expect(defaultCredentialRequirement('资质证书')).toBe('not_applicable')
    expect(defaultCredentialRequirement('品牌授权证明')).toBe('not_applicable')
    expect(defaultCredentialRequirement('完税证明')).toBe('optional')
  })

  it('按过期、30 天内临期、有效、长期和未录入计算有效期状态', () => {
    expect(credentialExpiryState({ expiresAt: '2026-07-29' }, NOW)).toBe('expired')
    expect(credentialExpiryState({ expiresAt: '2026-07-30' }, NOW)).toBe('expiring')
    expect(credentialExpiryState({ expiresAt: '2026-08-29' }, NOW)).toBe('expiring')
    expect(credentialExpiryState({ expiresAt: '2026-08-30' }, NOW)).toBe('valid')
    expect(credentialExpiryState({ expiresAt: '2020-01-01', longTerm: true }, NOW)).toBe('valid')
    expect(credentialExpiryState({}, NOW)).toBe('unrecorded')
  })

  it('以 Asia/Shanghai 业务日期判断跨 UTC 日界线的有效期', () => {
    const beforeShanghaiMidnight = new Date('2026-07-29T15:30:00.000Z')
    const afterShanghaiMidnight = new Date('2026-07-29T16:30:00.000Z')
    expect(shanghaiBusinessDate(beforeShanghaiMidnight)).toBe('2026-07-29')
    expect(shanghaiBusinessDate(afterShanghaiMidnight)).toBe('2026-07-30')
    expect(credentialExpiryState(
      { expiresAt: '2026-07-29' },
      beforeShanghaiMidnight,
    )).toBe('expiring')
    expect(credentialExpiryState(
      { expiresAt: '2026-07-29' },
      afterShanghaiMidnight,
    )).toBe('expired')
  })

  it('只产出 incomplete/reviewing，临期仍算已收到，过期必需资料不齐全', () => {
    const complete = [
      { category: '营业执照', expiresAt: '2028-01-01', hasAccessibleFile: true },
      { category: '法人身份证', expiresAt: '2026-08-10', hasAccessibleFile: true },
      { category: '基本存款账户信息', hasAccessibleFile: true },
    ]
    expect(resolveAutomaticCredentialStatus(complete, [], NOW)).toBe('reviewing')
    expect(resolveAutomaticCredentialStatus(
      complete.map(item => item.category === '法人身份证'
        ? { ...item, expiresAt: '2026-07-29' }
        : item),
      [],
      NOW,
    )).toBe('incomplete')
    expect(resolveAutomaticCredentialStatus(
      complete.map(item => item.category === '法人身份证'
        ? { ...item, hasAccessibleFile: false }
        : item),
      [],
      NOW,
    )).toBe('incomplete')
  })

  it('条件资料只有设为 required 后才影响齐全度', () => {
    const credentials = [
      { category: '营业执照', hasAccessibleFile: true },
      { category: '法人身份证', hasAccessibleFile: true },
      { category: '银行账户资料', hasAccessibleFile: true },
    ]
    expect(resolveAutomaticCredentialStatus(credentials, [{
      category: '资质证书',
      requirement: 'not_applicable',
    }], NOW)).toBe('reviewing')
    expect(resolveAutomaticCredentialStatus(credentials, [{
      category: '资质证书',
      requirement: 'required',
      reason: '专业施工合同要求',
    }], NOW)).toBe('incomplete')
  })

  it('人工合格与退回都必须有供应商级凭证', () => {
    expect(hasManualCredentialReviewProof({
      status: 'qualified',
      reviewedAt: null,
      reviewNote: '',
    })).toBe(false)
    expect(hasManualCredentialReviewProof({
      status: 'qualified',
      reviewedAt: '2026-07-30T09:00:00.000Z',
      reviewNote: '',
    })).toBe(true)
    expect(hasManualCredentialReviewProof({
      status: 'rejected',
      reviewedAt: '2026-07-30T09:00:00.000Z',
      reviewNote: '',
    })).toBe(false)
    expect(hasManualCredentialReviewProof({
      status: 'rejected',
      reviewedAt: '2026-07-30T09:00:00.000Z',
      reviewNote: '证照模糊',
    })).toBe(true)
  })
})
