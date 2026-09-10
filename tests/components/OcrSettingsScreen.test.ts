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
    database.execute.mockReset()
    database.select.mockReset()
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

  it('读取失败不冒充已保存或允许覆盖，重试成功后恢复真实旧配置', async () => {
    database.select.mockRejectedValueOnce(new Error('读取设置失败'))
    render(OcrSettingsScreen, { global: { stubs: { OcrDocumentSupportTable: true } } })
    expect(await screen.findByText('读取设置失败')).not.toBeNull()
    expect(screen.queryByText('已保存')).toBeNull()
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '恢复默认' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('checkbox', { name: '图表识别' }) as HTMLInputElement).disabled).toBe(true)
    expect(database.execute).not.toHaveBeenCalled()
    database.select.mockResolvedValueOnce([{ settings_json: JSON.stringify({ useChartRecognition: true, requestTimeoutMs: 45000 }) }])
    await fireEvent.click(screen.getByRole('button', { name: '重新读取设置' }))
    await waitFor(() => expect((screen.getByRole('checkbox', { name: '图表识别' }) as HTMLInputElement).checked).toBe(true))
    expect((screen.getByLabelText('单次请求超时（秒）') as HTMLInputElement).value).toBe('45')
    expect(screen.getByText('已保存')).not.toBeNull()
    expect(database.execute).not.toHaveBeenCalled()
  })

  it('保存失败保留用户草稿，重新保存成功才更新反馈', async () => {
    render(OcrSettingsScreen, { global: { stubs: { OcrDocumentSupportTable: true } } })
    await screen.findByText('已保存')
    const checkbox = await screen.findByRole('checkbox', { name: '图表识别' })
    await fireEvent.click(checkbox)
    database.execute.mockRejectedValueOnce(new Error('写入设置失败'))
    await fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(await screen.findByText('写入设置失败')).not.toBeNull()
    expect((checkbox as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('有未保存修改')).not.toBeNull()
    expect(screen.queryByRole('button', { name: '重新读取设置' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '保存设置' }))
    expect(await screen.findByText('设置已保存，将用于后续识别任务。')).not.toBeNull()
  })
})
