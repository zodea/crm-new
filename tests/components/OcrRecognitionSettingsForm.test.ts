import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import OcrRecognitionSettingsForm from '~/components/ocr/OcrRecognitionSettingsForm.vue'
import { createDefaultOcrRecognitionSettings } from '~/lib/ocr/settings'

describe('ocr 识别设置表单', () => {
  it('编辑真实能力并提供保存、恢复动作', async () => {
    const view = render(OcrRecognitionSettingsForm, {
      props: {
        modelValue: createDefaultOcrRecognitionSettings(),
        dirty: false,
        saving: false,
      },
    })

    await fireEvent.click(screen.getByRole('checkbox', { name: '图表识别' }))
    expect(view.emitted()['update:modelValue']?.[0]?.[0]).toEqual(expect.objectContaining({
      useChartRecognition: true,
    }))
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    expect(view.emitted().restoreDefault).toHaveLength(1)
  })

  it('未接入全局判读的阈值保持禁用', () => {
    render(OcrRecognitionSettingsForm, {
      props: {
        modelValue: createDefaultOcrRecognitionSettings(),
        dirty: true,
        saving: false,
      },
    })

    expect((screen.getByLabelText('建议通过阈值') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('注意阈值') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText(/尚未接入全局判读/)).not.toBeNull()
    expect(screen.queryByLabelText(/Token/)).toBeNull()
  })

  it('保存期间锁定全部可编辑控件', () => {
    render(OcrRecognitionSettingsForm, {
      props: {
        modelValue: createDefaultOcrRecognitionSettings(),
        dirty: true,
        saving: true,
      },
    })

    for (const checkbox of screen.getAllByRole('checkbox'))
      expect((checkbox as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('单次请求超时（秒）') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('任务轮询总超时（秒）') as HTMLInputElement).disabled).toBe(true)
  })

  it.each([
    ['单次请求超时（秒）', '', '请输入单次请求超时'],
    ['单次请求超时（秒）', '9', '单次请求超时须在 10–300 秒之间'],
    ['任务轮询总超时（秒）', '1801', '任务轮询总超时须在 60–1800 秒之间'],
  ])('拒绝非法超时：%s = %s', async (label, value, message) => {
    render(OcrRecognitionSettingsForm, {
      props: {
        modelValue: createDefaultOcrRecognitionSettings(),
        dirty: true,
        saving: false,
      },
    })

    await fireEvent.update(screen.getByLabelText(label), value)

    expect(screen.getByRole('alert').textContent).toContain(message)
    expect((screen.getByRole('button', { name: '保存设置' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
