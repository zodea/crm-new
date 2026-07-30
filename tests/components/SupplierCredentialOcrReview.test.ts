import type { CredentialOcrReviewField } from '~/lib/supplier/credential-ocr'
import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import SupplierCredentialOcrReview from '~/components/supplier/SupplierCredentialOcrReview.vue'

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
