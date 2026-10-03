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
  it.each([
    { case: '\'品牌授权证明\'', input: '品牌授权证明', expected: '品牌授权书' },
    { case: '\'品牌授权书\'', input: '品牌授权书', expected: '品牌授权书' },
  ])('把银行与品牌历史名称归一为稳定业务类别 / canonicalCredentialCategory：$case', ({ input, expected }) => {
    expect(canonicalCredentialCategory(input)).toBe(expected)
  })

  it.each(Array.from([
    '银行开户许可证',
    '开户许可证',
    '基本存款账户信息',
    '基本存款账户信息表',
  ]).map(input => ({ input })))('把银行与品牌历史名称归一为稳定业务类别：输入组合 1 案例 %#', ({ input: alias }) => {
    expect(canonicalCredentialCategory(alias)).toBe('银行账户资料')
  })

  it.each([
    { case: '\'营业执照\'', input: '营业执照', expected: 'required' },
    { case: '\'基本存款账户信息\'', input: '基本存款账户信息', expected: 'required' },
    { case: '\'资质证书\'', input: '资质证书', expected: 'not_applicable' },
    { case: '\'品牌授权证明\'', input: '品牌授权证明', expected: 'not_applicable' },
    { case: '\'完税证明\'', input: '完税证明', expected: 'optional' },
  ])('默认要求区分必需、条件不适用与可选资料 / defaultCredentialRequirement：$case', ({ input, expected }) => {
    expect(defaultCredentialRequirement(input)).toBe(expected)
  })

  it.each([
    { case: '{ expiresAt: \'2026-07-29\' } / NOW', input: { expiresAt: '2026-07-29' }, argument2: NOW, expected: 'expired' },
    { case: '{ expiresAt: \'2026-07-30\' } / NOW', input: { expiresAt: '2026-07-30' }, argument2: NOW, expected: 'expiring' },
    { case: '{ expiresAt: \'2026-08-29\' } / NOW', input: { expiresAt: '2026-08-29' }, argument2: NOW, expected: 'expiring' },
    { case: '{ expiresAt: \'2026-08-30\' } / NOW', input: { expiresAt: '2026-08-30' }, argument2: NOW, expected: 'valid' },
    { case: '{ expiresAt: \'2020-01-01\', longTerm: true } / NOW', input: { expiresAt: '2020-01-01', longTerm: true }, argument2: NOW, expected: 'valid' },
    { case: '{} / NOW', input: {}, argument2: NOW, expected: 'unrecorded' },
  ])('按过期、30 天内临期、有效、长期和未录入计算有效期状态 / credentialExpiryState：$case', ({ input, argument2, expected }) => {
    expect(credentialExpiryState(input, argument2)).toBe(expected)
  })

  describe('以 Asia/Shanghai 业务日期判断跨 UTC 日界线的有效期', () => {
    const beforeShanghaiMidnight = new Date('2026-07-29T15:30:00.000Z')
    const afterShanghaiMidnight = new Date('2026-07-29T16:30:00.000Z')
    it.each([
      { case: 'beforeShanghaiMidnight', input: beforeShanghaiMidnight, expected: '2026-07-29' },
      { case: 'afterShanghaiMidnight', input: afterShanghaiMidnight, expected: '2026-07-30' },
    ])('shanghaiBusinessDate：$case', ({ input, expected }) => {
      expect(shanghaiBusinessDate(structuredClone(input))).toBe(expected)
    })

    it.each([
      { case: '{ expiresAt: \'2026-07-29\' } / beforeShanghaiMidnight', input: { expiresAt: '2026-07-29' }, argument2: beforeShanghaiMidnight, expected: 'expiring' },
      { case: '{ expiresAt: \'2026-07-29\' } / afterShanghaiMidnight', input: { expiresAt: '2026-07-29' }, argument2: afterShanghaiMidnight, expected: 'expired' },
    ])('credentialExpiryState：$case', ({ input, argument2, expected }) => {
      expect(credentialExpiryState(structuredClone(input), structuredClone(argument2))).toBe(expected)
    })
  })

  describe('只产出 incomplete/reviewing，临期仍算已收到，过期必需资料不齐全', () => {
    const complete = [
      { category: '营业执照', expiresAt: '2028-01-01', hasAccessibleFile: true },
      { category: '法人身份证', expiresAt: '2026-08-10', hasAccessibleFile: true },
      { category: '基本存款账户信息', hasAccessibleFile: true },
    ]
    it.each([
      { case: 'complete / [] / NOW', input: complete, argument2: [], argument3: NOW, expected: 'reviewing' },
      { case: 'complete.map(item => item.category === \'法人身份证\' ? { ...item, expiresAt: \'2026-07-29\' } : item) / [] / NOW', input: complete.map(item => item.category === '法人身份证'
        ? { ...item, expiresAt: '2026-07-29' }
        : item), argument2: [], argument3: NOW, expected: 'incomplete' },
      { case: 'complete.map(item => item.category === \'法人身份证\' ? { ...item, hasAccessibleFile: false } : item) / [] / NOW', input: complete.map(item => item.category === '法人身份证'
        ? { ...item, hasAccessibleFile: false }
        : item), argument2: [], argument3: NOW, expected: 'incomplete' },
    ])('resolveAutomaticCredentialStatus：$case', ({ input, argument2, argument3, expected }) => {
      expect(resolveAutomaticCredentialStatus(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBe(expected)
    })
  })

  describe('条件资料只有设为 required 后才影响齐全度', () => {
    const credentials = [
      { category: '营业执照', hasAccessibleFile: true },
      { category: '法人身份证', hasAccessibleFile: true },
      { category: '银行账户资料', hasAccessibleFile: true },
    ]
    it.each([
      { case: 'credentials / [{ category: \'资质证书\', requirement: \'not_applicable\', }] / NOW', input: credentials, argument2: [{
        category: '资质证书',
        requirement: 'not_applicable',
      }], argument3: NOW, expected: 'reviewing' },
      { case: 'credentials / [{ category: \'资质证书\', requirement: \'required\', reason: \'专业施工合同要求\', }] / NOW', input: credentials, argument2: [{
        category: '资质证书',
        requirement: 'required',
        reason: '专业施工合同要求',
      }], argument3: NOW, expected: 'incomplete' },
    ])('resolveAutomaticCredentialStatus：$case', ({ input, argument2, argument3, expected }) => {
      expect(resolveAutomaticCredentialStatus(structuredClone(input), structuredClone(argument2), structuredClone(argument3))).toBe(expected)
    })
  })

  it.each([
    { case: '{ status: \'qualified\', reviewedAt: null, reviewNote: \'\', }', input: {
      status: 'qualified',
      reviewedAt: null,
      reviewNote: '',
    }, expected: false },
    { case: '{ status: \'qualified\', reviewedAt: \'2026-07-30T09:00:00.000Z\', reviewNote: \'\', }', input: {
      status: 'qualified',
      reviewedAt: '2026-07-30T09:00:00.000Z',
      reviewNote: '',
    }, expected: true },
    { case: '{ status: \'rejected\', reviewedAt: \'2026-07-30T09:00:00.000Z\', reviewNote: \'\', }', input: {
      status: 'rejected',
      reviewedAt: '2026-07-30T09:00:00.000Z',
      reviewNote: '',
    }, expected: false },
    { case: '{ status: \'rejected\', reviewedAt: \'2026-07-30T09:00:00.000Z\', reviewNote: \'证照模糊\', }', input: {
      status: 'rejected',
      reviewedAt: '2026-07-30T09:00:00.000Z',
      reviewNote: '证照模糊',
    }, expected: true },
  ])('人工合格与退回都必须有供应商级凭证 / hasManualCredentialReviewProof：$case', ({ input, expected }) => {
    expect(hasManualCredentialReviewProof(input)).toBe(expected)
  })
})
