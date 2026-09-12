import type { CredentialOcrReviewDraft, CredentialOcrReviewField } from '~/lib/supplier/credential-ocr'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import SupplierCredentialOcrReview from '~/components/supplier/SupplierCredentialOcrReview.vue'
import { buildCredentialOcrReview } from '~/lib/supplier/credential-ocr'

function fields(): CredentialOcrReviewField[] {
  return [
    {
      key: 'name',
      label: '公司名称',
      value: 'OCR 公司',
      confidence: 0.91,
      currentValue: '当前公司',
      decision: 'keep-current',
      manualValue: '',
      conflict: true,
    },
    {
      key: 'bank',
      label: '开户行',
      value: '示例银行',
      confidence: 0.84,
      currentValue: '',
      decision: 'use-recognized',
      manualValue: '',
      conflict: false,
    },
  ]
}

describe('supplier credential OCR review', () => {
  it('重新挂载恢复未保存的人工选择，同时使用最新当前值', async () => {
    const candidates = [{ id: 'name', key: 'name' as const, label: '公司名称', value: 'OCR 公司', confidence: 0.9 }]
    const { emitted, unmount } = render(SupplierCredentialOcrReview, { props: { fileName: '合成.pdf', category: { category: '营业执照', confidence: 0.9, evidence: [] }, fields: buildCredentialOcrReview(candidates, { name: '原公司' }) } })
    await fireEvent.click(within(screen.getByRole('group', { name: '公司名称' })).getByRole('radio', { name: '手工修改' }))
    await fireEvent.update(screen.getByLabelText('公司名称手工确认值'), '未保存人工名')
    const draft = emitted().draftChange?.at(-1)?.[0] as CredentialOcrReviewDraft
    expect(draft).toMatchObject({ choices: expect.arrayContaining([{ key: 'name', decision: 'manual', manualValue: '未保存人工名' }]) })
    unmount()
    render(SupplierCredentialOcrReview, { props: { fileName: '合成.pdf', category: { category: '营业执照', confidence: 0.9, evidence: [] }, fields: buildCredentialOcrReview(candidates, { name: '最新公司' }), draft } })
    expect(screen.getByText('最新公司')).toBeTruthy()
    expect((screen.getByLabelText('公司名称手工确认值') as HTMLInputElement).value).toBe('未保存人工名')
  })

  it('重新核对更新当前事实，但保留已经填写的人工选择', async () => {
    const candidates = [{ id: 'name', key: 'name' as const, label: '公司名称', value: 'OCR 公司', confidence: 0.9 }]
    const { emitted, rerender } = render(SupplierCredentialOcrReview, { props: { fileName: '合成.pdf', category: { category: '营业执照', confidence: 0.9, evidence: [] }, fields: buildCredentialOcrReview(candidates, { name: '原公司' }) } })
    await fireEvent.click(within(screen.getByRole('group', { name: '公司名称' })).getByRole('radio', { name: '手工修改' }))
    await fireEvent.update(screen.getByLabelText('公司名称手工确认值'), '保留的人工输入')
    await rerender({ fields: buildCredentialOcrReview(candidates, { name: '新主档公司' }) })
    expect(screen.getByText('新主档公司')).not.toBeNull()
    expect((screen.getByLabelText('公司名称手工确认值') as HTMLInputElement).value).toBe('保留的人工输入')
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[0]?.[0]).toMatchObject({ fields: { name: '保留的人工输入' }, choices: expect.arrayContaining([{ key: 'name', decision: 'manual', manualValue: '保留的人工输入' }]) })
  })

  it('日期先后冲突阻止确认，明确长期有效后不把旧到期值写回', async () => {
    const { emitted } = render(SupplierCredentialOcrReview, { props: { fileName: '合成.pdf', category: { category: '资质证书', confidence: 0.9, evidence: [] }, fields: [] } })
    await fireEvent.update(screen.getByLabelText('生效日期手工确认值'), '2027-01-01')
    await fireEvent.update(screen.getByLabelText('到期日期手工确认值'), '2026-01-01')
    expect((screen.getByRole('button', { name: '保存核对结果' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('截止日期不能早于开始日期')
    const lifetime = screen.getByRole('group', { name: '长期有效状态' })
    await fireEvent.click(within(lifetime).getByRole('radio', { name: '手工确认' }))
    await fireEvent.click(within(lifetime).getByRole('checkbox', { name: '手工设为长期有效' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[0]?.[0]).toMatchObject({ fields: { validFrom: '2027-01-01' }, longTerm: true })
    expect((emitted().confirm?.[0]?.[0] as { fields: object }).fields).not.toHaveProperty('expiresAt')
  })

  it('矛盾税号以稳定候选明确单选，显示真实目标且不由后一行覆盖', async () => {
    const candidates = [
      { id: 'credit', key: 'taxNo' as const, label: '统一社会信用代码', sourceLabel: '统一社会信用代码', value: '91440000TEST123456', confidence: 0.9 },
      { id: 'tax', key: 'taxNo' as const, label: '纳税人识别号', sourceLabel: '纳税人识别号', value: '91440000TEST654321', confidence: 0.9 },
    ]
    const { emitted } = render(SupplierCredentialOcrReview, { props: { fileName: '合成.pdf', category: { category: '营业执照', confidence: 0.9, evidence: [] }, fields: buildCredentialOcrReview(candidates, { taxNo: '当前税号', uniqueCode: 'INTERNAL' }) } })
    const group = screen.getByRole('group', { name: '统一社会信用代码 / 税号' })
    expect(within(group).getByText('当前税号')).not.toBeNull()
    expect(within(group).queryByText('INTERNAL')).toBeNull()
    await fireEvent.click(within(group).getByRole('radio', { name: '使用识别值 1：统一社会信用代码' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[0]?.[0]).toMatchObject({ fields: { taxNo: '91440000TEST123456' }, choices: expect.arrayContaining([{ key: 'taxNo', decision: 'use-recognized', candidateId: 'credit' }]) })
    await fireEvent.click(within(group).getByRole('radio', { name: '使用识别值 2：纳税人识别号' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[1]?.[0]).toMatchObject({ fields: { taxNo: '91440000TEST654321' } })
  })

  it('类别冲突默认保留当前类别并记录决定', async () => {
    const { emitted } = render(SupplierCredentialOcrReview, {
      props: {
        fileName: '合成营业执照.pdf',
        currentCategory: '资质证书',
        category: {
          category: '营业执照',
          confidence: 0.87,
          evidence: ['营业执照'],
        },
        fields: fields(),
      },
    })

    expect(screen.getByText('当前：资质证书')).not.toBeNull()
    expect(screen.getByText('OCR 建议：营业执照')).not.toBeNull()
    expect((screen.getByRole('radio', { name: '保留当前类别' }) as HTMLInputElement).checked)
      .toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[0]?.[0]).toMatchObject({
      category: '资质证书',
      decisions: {
        category: 'keep-current',
      },
    })
  })

  it('冲突默认保留当前值，确认时只采用用户选定结果', async () => {
    const { emitted } = render(SupplierCredentialOcrReview, {
      props: {
        fileName: '合成营业执照.pdf',
        category: {
          category: '营业执照',
          confidence: 0.87,
          evidence: ['营业执照'],
        },
        fields: fields(),
      },
    })

    expect(screen.getByText('存在冲突')).not.toBeNull()
    const keepCurrent = screen.getAllByRole('radio', { name: '保留当前值' })[0] as HTMLInputElement
    expect(keepCurrent.checked).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[0]?.[0]).toMatchObject({
      category: '营业执照',
      fields: {
        name: '当前公司',
        bank: '示例银行',
      },
      decisions: {
        name: 'keep-current',
        bank: 'use-recognized',
      },
    })
  })

  it('手工模式必须填写确认值后才能保存', async () => {
    const { emitted } = render(SupplierCredentialOcrReview, {
      props: {
        fileName: '合成资料.png',
        category: {
          category: '营业执照',
          confidence: 0.68,
          evidence: [],
        },
        fields: fields(),
      },
    })

    const manual = screen.getAllByRole('radio', { name: '手工修改' })[0]!
    await fireEvent.click(manual)

    const save = screen.getByRole('button', { name: '保存核对结果' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('公司名称')

    await fireEvent.update(screen.getByRole('textbox', { name: '公司名称手工确认值' }), '人工确认公司')
    expect(save.disabled).toBe(false)
    await fireEvent.click(save)

    expect(emitted().confirm?.[0]?.[0]).toMatchObject({
      fields: {
        name: '人工确认公司',
      },
    })
  })

  it('未识别有效期时仍允许人工补录或确认长期有效', async () => {
    const { emitted } = render(SupplierCredentialOcrReview, {
      props: {
        fileName: '合成资料.png',
        category: {
          category: '资质证书',
          confidence: 0.7,
          evidence: ['资质证书'],
        },
        fields: [],
      },
    })

    await fireEvent.update(screen.getByLabelText('生效日期手工确认值'), '2026-01-01')
    await fireEvent.update(screen.getByLabelText('到期日期手工确认值'), '2027-01-01')
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))

    expect(emitted().confirm?.[0]?.[0]).toMatchObject({
      fields: {
        validFrom: '2026-01-01',
        expiresAt: '2027-01-01',
      },
      longTerm: false,
    })
  })

  it('日期冲突的保留、采用与手工修改都使用同一决策来源', async () => {
    const { emitted } = render(SupplierCredentialOcrReview, {
      props: {
        fileName: '合成身份证.png',
        category: {
          category: '法人身份证',
          confidence: 0.9,
          evidence: ['身份证'],
        },
        fields: [{
          key: 'validFrom',
          label: '生效日期',
          value: '2024-01-01',
          confidence: 0.9,
          currentValue: '2020-01-01',
          decision: 'keep-current',
          manualValue: '',
          conflict: true,
        }],
      },
    })

    const group = screen.getByRole('group', { name: '生效日期' })
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[0]?.[0]).toMatchObject({
      fields: { validFrom: '2020-01-01' },
    })

    await fireEvent.click(within(group).getByRole('radio', { name: '使用识别值' }))
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[1]?.[0]).toMatchObject({
      fields: { validFrom: '2024-01-01' },
    })

    await fireEvent.click(within(group).getByRole('radio', { name: '手工修改' }))
    await fireEvent.update(screen.getByLabelText('生效日期手工确认值'), '2025-06-01')
    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    expect(emitted().confirm?.[2]?.[0]).toMatchObject({
      fields: { validFrom: '2025-06-01' },
    })
  })
})
