import { describe, expect, it } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { loadProjectAcceptanceLifecycle } from '~/lib/project/acceptance-lifecycle'
import { createMemoryDb } from '../helpers/memory-db'

describe('project acceptance lifecycle read model', () => {
  it('preserves stored lifecycle states and enforces project/contract ownership', async () => {
    const db = await createMemoryDb()
    await runMigrations(db)
    await db.execute(`INSERT INTO customers (id, name) VALUES ('customer-acceptance', '验收客户')`)
    await db.execute(`
      INSERT INTO projects (id, name, customer_id)
      VALUES
        ('project-acceptance', '验收项目', 'customer-acceptance'),
        ('project-acceptance-other', '其他验收项目', 'customer-acceptance')
    `)
    await db.execute(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, amount, status
      )
      VALUES
        (
          'contract-acceptance', 'SG-ACCEPTANCE', '验收施工合同',
          '施工', 'project-acceptance', 1000, '履约中'
        ),
        (
          'contract-acceptance-other', 'SG-OTHER', '其他项目施工合同',
          '施工', 'project-acceptance-other', 900, '履约中'
        )
    `)
    await db.execute(`
      INSERT INTO project_acceptances (
        id, no, type, name, project_id, contract_id, document_date,
        contract_estimate, acceptor, warranty_owner, conclusion, status, deleted_at
      )
      VALUES
        (
          'acceptance-draft', 'YS-DRAFT', 'acceptance', '验收草稿',
          'project-acceptance', 'contract-acceptance', '2026-07-01',
          100, '验收员', '', '', 'draft', NULL
        ),
        (
          'acceptance-submitted', 'YS-SUBMITTED', 'acceptance', '待验收单',
          'project-acceptance', 'contract-acceptance', '2026-07-02',
          200, '验收员', '', '待验收', 'submitted', NULL
        ),
        (
          'acceptance-accepted-physical-warranty', 'YS-ACCEPTED', 'warranty', '已验收单',
          'project-acceptance', 'contract-acceptance', '2026-07-03',
          300, '验收员', '保修负责人', '验收通过', 'accepted', NULL
        ),
        (
          'acceptance-warranty', 'YS-WARRANTY', 'warranty', '保修移交单',
          'project-acceptance', 'contract-acceptance', '2026-07-04',
          400, '验收员', '保修负责人', '进入保修', 'warranty', NULL
        ),
        (
          'acceptance-expired', 'YS-EXPIRED', 'warranty', '保修到期单',
          'project-acceptance', 'contract-acceptance', '2026-07-05',
          500, '验收员', '保修负责人', '保修完成', 'expired', NULL
        ),
        (
          'acceptance-mismatch', 'YS-MISMATCH', 'acceptance', '错合同项目',
          'project-acceptance', 'contract-acceptance-other', '2026-07-06',
          600, '验收员', '', '', 'submitted', NULL
        ),
        (
          'acceptance-deleted', 'YS-DELETED', 'acceptance', '已删验收',
          'project-acceptance', 'contract-acceptance', '2026-07-07',
          700, '验收员', '', '', 'submitted', '2026-07-08'
        )
    `)
    await db.execute(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, category, deleted_at
      )
      VALUES
        (
          'acceptance-file-active', 'project_acceptance', 'acceptance-warranty',
          '保修移交.pdf', '验收附件', NULL
        ),
        (
          'acceptance-file-deleted', 'project_acceptance', 'acceptance-warranty',
          '已删附件.pdf', '验收附件', '2026-07-08'
        )
    `)

    const rows = await loadProjectAcceptanceLifecycle(db)
    expect(rows.find(row => row.id === 'acceptance-draft')).toMatchObject({
      status: 'draft',
      statusLabel: '草稿',
      lifecycleStage: 0,
      contractEstimate: 100,
      effectiveEstimate: 0,
    })
    expect(rows.find(row => row.id === 'acceptance-accepted-physical-warranty')).toMatchObject({
      type: '保修确认',
      status: 'accepted',
      statusLabel: '已验收',
      lifecycleStage: 2,
    })
    expect(rows.find(row => row.id === 'acceptance-warranty')).toMatchObject({
      contractName: '验收施工合同',
      status: 'warranty',
      statusLabel: '保修中',
      lifecycleStage: 3,
      attachmentCount: 1,
      sourcePath: '/owner/acceptance/acceptance-warranty',
    })
    expect(rows.find(row => row.id === 'acceptance-expired')).toMatchObject({
      status: 'expired',
      statusLabel: '保修到期',
      lifecycleStage: 4,
    })
    expect(rows.some(row => row.id === 'acceptance-mismatch')).toBe(false)
    expect(rows.some(row => row.id === 'acceptance-deleted')).toBe(false)
  })
})
