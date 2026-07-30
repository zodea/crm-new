import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import OcrRuntimeStatusCard from '~/components/ocr/OcrRuntimeStatusCard.vue'

describe('ocr 运行状态卡', () => {
  it('已配置时展示固定引擎、模型和服务端私有凭证边界', () => {
    render(OcrRuntimeStatusCard, {
      props: {
        status: {
          configured: true,
          engine: 'paddleocr-official-api',
          model: 'PaddleOCR-VL-1.6',
        },
        loading: false,
        error: '',
      },
    })

    expect(screen.getByText('服务可用配置已就绪')).not.toBeNull()
    expect(screen.getByText('PaddleOCR-VL-1.6')).not.toBeNull()
    expect(screen.getByText(/Token 仅在 Nitro 服务端环境变量中保存/)).not.toBeNull()
    expect(screen.queryByLabelText(/Token/)).toBeNull()
  })

  it('未配置或读取失败时提供明确状态和重试动作', async () => {
    const view = render(OcrRuntimeStatusCard, {
      props: {
        status: {
          configured: false,
          engine: 'paddleocr-official-api',
          model: 'PaddleOCR-VL-1.6',
        },
        loading: false,
        error: '状态接口暂时不可用',
      },
    })

    expect(screen.getByRole('alert').textContent).toContain('状态接口暂时不可用')
    await fireEvent.click(screen.getByRole('button', { name: '重新检测' }))
    expect(view.emitted().refresh).toHaveLength(1)
  })
})
