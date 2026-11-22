import { render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { annotateProjectImportRows } from '~/lib/project/import'
import ProjectImportReview from '~/pages/import/mapping/_components/ProjectImportReview.vue'

describe('项目导入人工核对', () => {
  it('显示解析后的稳定关系、归一阶段和原 Sheet 行号，失败行不伪装成可导入', () => {
    const rows = annotateProjectImportRows([
      { name: '正常项目', status: '旧阶段' },
      { name: '失败项目', status: '施工中' },
    ], { name: '项目表', columns: ['项目'], rows: [{ 项目: '正常项目' }, { 项目: '失败项目' }], headerRow: 1, rowNumbers: [4, 7] })
    render(ProjectImportReview, { props: {
      entries: rows.map((row, index) => ({ row, index })),
      reviewed: { 0: { draft: { customerId: 'customer-423', secondaryCustomerId: 'customer-424', status: '筹备中' } }, 1: { error: '客户存在歧义，请改用客户稳定 ID' } },
    } })
    const region = screen.getByRole('region', { name: '客户身份与阶段核对表' })
    expect(region.getAttribute('tabindex')).toBe('0')
    const valid = within(region).getByRole('row', { name: /正常项目/ })
    expect(valid.textContent).toContain('旧阶段 → 筹备中')
    expect(within(valid).getByRole('cell', { name: '4', exact: true })).toBeTruthy()
    expect(within(valid).getByRole('cell', { name: 'customer-423' })).toBeTruthy()
    expect(within(valid).getByRole('cell', { name: 'customer-424' })).toBeTruthy()
    const rejected = within(region).getByRole('row', { name: /失败项目/ })
    expect(within(rejected).getByRole('cell', { name: '7', exact: true })).toBeTruthy()
    expect(rejected.textContent).toContain('客户存在歧义')
    expect(within(rejected).queryByText('可导入')).toBeNull()
  })
})
