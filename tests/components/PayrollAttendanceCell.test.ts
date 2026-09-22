import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import PayrollAttendanceCellDialog from '~/components/payroll/PayrollAttendanceCellDialog.vue'
import { c1Matrix } from '../helpers/payroll-c1-ui'

describe('中央原单元格输入', () => {
  it('修改尚未保存时关闭需明确放弃，取消确认保留原工时', async () => {
    const confirm = vi.fn().mockResolvedValue(false)
    vi.stubGlobal('useKitUI', () => ({ confirm }))
    const view = render(PayrollAttendanceCellDialog, { props: { open: true, worker: c1Matrix().workers[0]!, workDate: '2026-08-02', records: [], busy: false, pending: false, error: '', readonlyReasons: [] }, global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } })
    await fireEvent.update(await screen.findByLabelText('正常工时'), '7.51')
    await fireEvent.click(screen.getAllByRole('button', { name: '关闭' }).at(-1)!)
    expect(confirm).toHaveBeenCalledOnce()
    expect(view.emitted()['update:open']).toBeUndefined()
    expect((screen.getByLabelText('正常工时') as HTMLInputElement).value).toBe('7.51')
  })
  it('新格默认未保存，7.51 保精度；空白拒绝，失败保输入', async () => {
    const props = { open: true, worker: c1Matrix().workers[0]!, workDate: '2026-08-02', records: [], busy: false, pending: false, error: '', readonlyReasons: [] }
    const view = render(PayrollAttendanceCellDialog, { props, global: { stubs: { KitButton: { template: '<button><slot /></button>' } } } })
    expect((await screen.findByLabelText('正常工时') as HTMLInputElement).value).toBe('8')
    expect(view.emitted().save).toBeUndefined()
    await fireEvent.update(screen.getByLabelText('正常工时'), '7.51')
    await fireEvent.click(screen.getByRole('button', { name: '保存考勤' }))
    expect(view.emitted().save?.[0]?.[0]).toMatchObject({ workerId: 'w', workDate: '2026-08-02', hours: 7.51 })
    await view.rerender({ ...props, error: '来源变化' })
    expect((screen.getByLabelText('正常工时') as HTMLInputElement).value).toBe('7.51')
    await fireEvent.update(screen.getByLabelText('正常工时'), '')
    expect(screen.getAllByRole('alert').some(element => element.textContent?.includes('非负工时'))).toBe(true)
  })
  it('同一原格随页签隐藏再显示，空白与内容输入仍保留', async () => {
    const props = { open: true, worker: c1Matrix().workers[0]!, workDate: '2026-08-02', records: [], busy: false, pending: false, error: '', readonlyReasons: [] }
    const view = render(PayrollAttendanceCellDialog, { props })
    await fireEvent.update(await screen.findByLabelText('正常工时'), '')
    await fireEvent.update(screen.getByLabelText('施工内容'), '切页签前未保存内容')
    await view.rerender({ ...props, open: false })
    await view.rerender(props)
    expect((await screen.findByLabelText('正常工时') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('施工内容') as HTMLInputElement).value).toBe('切页签前未保存内容')
  })
})
