import { describe, expect, it } from 'vitest'
import {
  PROJECT_DETAIL_TABS,
  projectArchivedInvoices,
} from '~/lib/project/subtables'

describe('project detail subtable definitions', () => {
  it('keeps exactly four real tabs and six placeholders', () => {
    expect(PROJECT_DETAIL_TABS).toHaveLength(10)
    expect(PROJECT_DETAIL_TABS.filter(tab => tab.kind === 'real').map(tab => tab.key)).toEqual([
      'detail',
      'construction',
      'tax',
      'fund',
    ])
    expect(PROJECT_DETAIL_TABS.filter(tab => tab.kind === 'placeholder').map(tab => tab.key)).toEqual([
      'budget',
      'expenditure',
      'current',
      'payment',
      'material',
      'acceptance',
    ])
  })
})

describe('projectArchivedInvoices', () => {
  it('only returns archived invoices assigned to the requested project', () => {
    const rows = [
      { id: 'archived-target', projectId: 'p1', accountStatus: 'archived' },
      { id: 'reviewed-only', projectId: 'p1', accountStatus: 'none' },
      { id: 'other-project', projectId: 'p2', accountStatus: 'archived' },
      { id: 'personal', projectId: null, accountStatus: 'archived' },
    ] as const

    expect(projectArchivedInvoices(rows, 'p1').map(row => row.id)).toEqual(['archived-target'])
  })
})
