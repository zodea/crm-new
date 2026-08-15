import { fireEvent, render, screen, within } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import MigrationPreflightPanel from '~/components/migration/MigrationPreflightPanel.vue'
import MigrationReconciliationTable from '~/components/migration/MigrationReconciliationTable.vue'
import MigrationSwitchPanel from '~/components/migration/MigrationSwitchPanel.vue'

describe('核心身份迁移展示面板', () => {
  const evidence = {
    field: 'customerId',
    sourceValue: 'legacy-customer-1',
    expectedValue: '—',
    actualValue: '—',
    difference: '—',
    attribution: '缺失来源',
  }
  it('展示预检版本、模式、结论和不可变备份，并向容器请求下一步动作', async () => {
    const view = render(MigrationPreflightPanel, {
      props: {
        schemaVersion: 'legacy-v42',
        mode: '只读迁移来源',
        checks: [
          { id: 'schema', label: '旧库结构', conclusion: 'passed', detail: '结构版本可迁移' },
          { id: 'relations', label: '核心关系', conclusion: 'blocked', detail: '发现 2 条缺失关系' },
        ],
        backup: { id: 'backup-20260815-001', immutable: true },
      },
    })

    const panel = screen.getByRole('region', { name: '迁移预检' })
    expect(within(panel).getByText('legacy-v42')).not.toBeNull()
    expect(within(panel).getByText('只读迁移来源')).not.toBeNull()
    expect(within(panel).getByText('旧库结构')).not.toBeNull()
    expect(within(panel).getByText('结构版本可迁移')).not.toBeNull()
    expect(within(panel).getByText('发现 2 条缺失关系')).not.toBeNull()
    expect(within(panel).getByText('backup-20260815-001')).not.toBeNull()
    expect(within(panel).getByText('不可变备份')).not.toBeNull()

    await fireEvent.click(within(panel).getByRole('button', { name: '运行预检' }))
    await fireEvent.click(within(panel).getByRole('button', { name: '创建不可变备份' }))
    expect(view.emitted().preflight).toHaveLength(1)
    expect(view.emitted().createBackup).toHaveLength(1)
  })

  it('按实体、旧 ID、命令、差异类型和原因定位全部对账问题', () => {
    render(MigrationReconciliationTable, {
      props: {
        state: 'checked',
        rows: [
          { ...evidence, id: 'issue-1', entity: '项目分供方', legacyId: 'legacy-ps-7', commandId: 'cmd-7', type: 'missing-relation', reason: '缺少 canonical 项目关系' },
          { ...evidence, id: 'issue-2', entity: '客户', legacyId: 'legacy-c-2', commandId: 'cmd-8', type: 'count-mismatch', reason: '迁移前后数量不同' },
          { ...evidence, id: 'issue-3', entity: '项目', legacyId: 'legacy-p-3', commandId: 'cmd-9', type: 'amount-mismatch', reason: '合同金额不一致' },
          { ...evidence, id: 'issue-4', entity: '工人', legacyId: 'legacy-w-4', commandId: null, type: 'reference-mismatch', reason: '班组引用不一致' },
          { ...evidence, id: 'issue-5', entity: '分供方', legacyId: 'legacy-s-5', commandId: 'cmd-10', type: 'soft-delete-mismatch', reason: '软删除状态不一致' },
          { ...evidence, id: 'issue-6', entity: '班组', legacyId: 'legacy-g-6', commandId: null, type: 'orphan', reason: '存在孤儿记录' },
        ],
      },
    })

    const table = screen.getByRole('table', { name: '迁移对账问题' })
    expect(within(table).getByRole('columnheader', { name: '实体' })).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '旧 ID' })).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '命令' })).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '类型' })).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '字段' })).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '来源值' })).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '归因' })).not.toBeNull()
    expect(within(table).getByRole('columnheader', { name: '原因' })).not.toBeNull()
    expect(within(table).getByText('legacy-ps-7')).not.toBeNull()
    expect(within(table).getByText('cmd-7')).not.toBeNull()
    for (const label of ['缺失关系', '数量不一致', '金额不一致', '引用不一致', '软删除不一致', '孤儿记录'])
      expect(within(table).getByText(label)).not.toBeNull()
  })

  it('对账没有问题时明确说明可以继续，而不是渲染空白表格', () => {
    render(MigrationReconciliationTable, { props: { rows: [], state: 'checked' } })

    expect(screen.getByRole('status').textContent).toContain('对账通过，未发现迁移差异')
    expect(screen.queryByRole('table', { name: '迁移对账问题' })).toBeNull()
  })

  it('尚未运行 dry-run 时显示等待态，不把未知误报为对账通过', () => {
    render(MigrationReconciliationTable, { props: { rows: [], state: 'unchecked' } })

    expect(screen.getByRole('status').textContent).toContain('尚未执行迁移对账')
    expect(screen.queryByText('对账通过，未发现迁移差异')).toBeNull()
  })

  it('刷新已确认迁移时说明历史明细未恢复，而不是显示尚未执行', () => {
    render(MigrationReconciliationTable, { props: { rows: [], state: 'verified' } })

    expect(screen.getByRole('status').textContent).toContain('中央切换前已完成对账')
    expect(screen.queryByText('尚未执行迁移对账')).toBeNull()
  })

  it('中央已回滚而本地待恢复时显示恢复态，不误报已核验一致', () => {
    render(MigrationReconciliationTable, { props: { rows: [], state: 'rollback-pending' } })

    expect(screen.getByRole('status').textContent).toContain('等待恢复本地快照')
    expect(screen.queryByText('批次与本机回滚标记仍已核验一致')).toBeNull()
  })

  it('按前置状态控制确认切换与回滚，并只向容器发出动作', async () => {
    const blocked = render(MigrationSwitchPanel, {
      props: {
        status: 'ready',
        rollbackExpiresAt: null,
        preflightPassed: true,
        backupReady: true,
        reconciliationPassed: false,
      },
    })
    const blockedPanel = screen.getByRole('region', { name: '中央后台切换' })
    expect(within(blockedPanel).getByText('待确认切换')).not.toBeNull()
    expect((within(blockedPanel).getByRole('button', { name: '确认切换中央后台' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(blockedPanel).getByRole('button', { name: '回滚到本地快照' }) as HTMLButtonElement).disabled).toBe(true)
    blocked.unmount()

    const ready = render(MigrationSwitchPanel, {
      props: {
        status: 'ready',
        rollbackExpiresAt: null,
        preflightPassed: true,
        backupReady: true,
        reconciliationPassed: true,
      },
    })
    await fireEvent.click(screen.getByRole('button', { name: '确认切换中央后台' }))
    expect(ready.emitted().confirmSwitch).toHaveLength(1)
    ready.unmount()

    const switched = render(MigrationSwitchPanel, {
      props: {
        status: 'switched',
        rollbackExpiresAt: '2026-08-22T08:00:00.000Z',
        preflightPassed: true,
        backupReady: true,
        reconciliationPassed: true,
      },
    })
    const switchedPanel = screen.getByRole('region', { name: '中央后台切换' })
    expect(within(switchedPanel).getByText('已切换中央后台')).not.toBeNull()
    expect(within(switchedPanel).getByText('2026-08-22T08:00:00.000Z')).not.toBeNull()
    await fireEvent.click(within(switchedPanel).getByRole('button', { name: '回滚到本地快照' }))
    expect(switched.emitted().rollback).toHaveLength(1)
    switched.unmount()

    const pendingRecovery = render(MigrationSwitchPanel, {
      props: {
        status: 'rollback-pending',
        rollbackExpiresAt: '2026-08-22T08:00:00.000Z',
        preflightPassed: true,
        backupReady: true,
        reconciliationPassed: true,
      },
    })
    expect(screen.getByText('中央已回滚，待恢复本地快照')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '回滚到本地快照' }))
    expect(pendingRecovery.emitted().rollback).toHaveLength(1)
  })
})
