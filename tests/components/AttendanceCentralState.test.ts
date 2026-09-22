import { render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import AttendanceGrid from '~/components/payroll/CentralAttendanceGrid.vue'
import { c1AttendanceFact, c1Matrix } from '../helpers/payroll-c1-ui'

describe('中央考勤矩阵精度', () => {
  it('原工时 7.51 不截为一位小数', () => {
    render(AttendanceGrid, { props: { month: '2026-08', workers: c1Matrix().workers, records: [c1AttendanceFact()], locks: [] } })
    expect(screen.getByRole('button', { name: '原工人 2026-08-01 考勤' }).textContent).toContain('7.51')
  })
  it('零、无记录和旧缺工时各自呈现，历史工人仍可查看', () => {
    render(AttendanceGrid, { props: { month: '2026-08', workers: c1Matrix().workers.map(worker => ({ ...worker, eligible: false, historical: true })), records: [c1AttendanceFact({ hours: 0 }), c1AttendanceFact({ id: 'r2', workDate: '2026-08-02', hours: null })], locks: [] } })
    expect(screen.getByRole('button', { name: '原工人 2026-08-01 考勤' }).textContent).toBe('0')
    expect(screen.getByRole('button', { name: '原工人 2026-08-02 考勤' }).textContent).toContain('未记录')
    expect(screen.getByRole('button', { name: '原工人 2026-08-03 考勤' }).textContent).toBe('—')
    expect((screen.getByRole('button', { name: '原工人 2026-08-31 考勤' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
