import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OcrSettingsScreen from '~/components/ocr/OcrSettingsScreen.vue'

const database = vi.hoisted(() => ({
  execute: vi.fn(async () => {}),
  select: vi.fn(async <T>() => [] as T[]),
}))

vi.mock('~/lib/db/client', () => ({
  db: database,
}))

describe('ocr 设置页面', () => {
  beforeEach(() => {
    database.execute.mockClear()
    database.select.mockClear()
    setActivePinia(createPinia())
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      configured: true,
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
    }), {
      headers: { 'content-type': 'application/json' },
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('保存后再次编辑会清除过期的成功提示', async () => {
    render(OcrSettingsScreen, {
      global: {
        stubs: {
          OcrDocumentSupportTable: true,
        },
      },
    })

    const chartRecognition = await screen.findByRole('checkbox', { name: '图表识别' })
    await fireEvent.click(chartRecognition)
    await fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(await screen.findByText('设置已保存，将用于后续识别任务。')).not.toBeNull()

    await fireEvent.click(screen.getByRole('checkbox', { name: '图表识别' }))

    await waitFor(() => {
      expect(screen.getByText('有未保存修改')).not.toBeNull()
      expect(screen.queryByText('设置已保存，将用于后续识别任务。')).toBeNull()
    })
  })
})
