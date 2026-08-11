import { describe, expect, it } from 'vitest'
import { amountHints, dateHints, lineItemCount, summarizeOcrPayload } from '../../scripts/ocr-sample-runner.mjs'

describe('ocr 真实样本运行结果摘要', () => {
  it('提取日期与金额提示，不保留原始 OCR 文本', () => {
    expect(dateHints('开票日期：2026年08月11日')).toEqual(['2026-08-11'])
    expect(amountHints('价税合计：1,234.50\n税额：12.00')).toEqual(['1234.50', '12.00'])
  })

  it('统计 Markdown 表格明细行', () => {
    expect(lineItemCount('| 名称 | 数量 |\n| --- | --- |\n| 电线 | 2 |\n| 线管 | 3 |')).toBe(2)
  })

  it('为成功结果生成字段、明细和差异摘要骨架', () => {
    const summary = summarizeOcrPayload({
      markdownPages: ['购买方：甲方\n开票日期：2026-08-11\n价税合计：100.00\n| 名称 | 数量 |\n| --- | --- |\n| 电线 | 2 |'],
    }, 'invoice')

    expect(summary).toMatchObject({
      recognized: {
        dates: ['2026-08-11'],
        counterparties: ['甲方'],
        amounts: ['100.00'],
        lineItemCount: 1,
      },
      comparison: {
        status: 'pending',
        lineItems: { sourceCount: null, recognizedCount: 1, status: 'pending' },
        differences: [],
      },
    })
    expect(JSON.stringify(summary)).not.toContain('购买方：甲方')
  })
})
