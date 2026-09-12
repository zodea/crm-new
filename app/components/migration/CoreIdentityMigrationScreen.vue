<script setup lang="ts">
import type {
  MigrationCheckConclusion,
} from './MigrationPreflightPanel.vue'
import type {
  MigrationReconciliationRowDisplay,
  MigrationReconciliationType,
} from './MigrationReconciliationTable.vue'
import type { MigrationSwitchStatus } from './MigrationSwitchPanel.vue'
import type {
  CoreMigrationEntityType,
  CoreMigrationIssueMetric,
} from '~/lib/migration/core-contract'
import { isTauri } from '@tauri-apps/api/core'
import { computed, onMounted } from 'vue'
import KitButton from '~/components/ui/KitButton.vue'
import { isCoreMigrationBlockingIssue } from '~/lib/migration/core-contract'
import { useCoreMigrationStore } from '~/stores/core-migration'
import MigrationPreflightPanel from './MigrationPreflightPanel.vue'
import MigrationReconciliationTable from './MigrationReconciliationTable.vue'
import MigrationSwitchPanel from './MigrationSwitchPanel.vue'

const store = useCoreMigrationStore()
const nativeUnsupported = isTauri()

const entityLabels: Record<CoreMigrationEntityType, string> = {
  auxiliary_contracts: '其他支出与公司支出合同',
  other_settlements: '其他支出结算',
  other_settlement_sources: '其他支出结算付款源单',
  customers: '客户',
  suppliers: '分供方',
  crews: '班组',
  projects: '项目',
  construction_contracts: '施工合同',
  subcontract_contracts: '分包合同',
  contract_supplements: '补充协议',
  receipt_registrations: '收款登记',
  delivery_records: '送货归档、原件与修订',
  quantity_projects: '工程量区域、模板与完成',
  process_libraries: '标准工序库与不可变版本',
  wbs_projects: '项目 WBS 与完整计划历史',
  supplier_credentials: '分供方证照、原件与核验凭证',
  owner_documents: '甲方变洽签、月度报量、验收保修与最终结算',
  workers: '工人',
  project_suppliers: '项目分供方',
}

const issueTypeByMetric: Record<CoreMigrationIssueMetric, MigrationReconciliationType> = {
  'count': 'count-mismatch',
  'amount': 'amount-mismatch',
  'quantity': 'count-mismatch',
  'missing-relation': 'missing-relation',
  'orphan': 'orphan',
  'soft-delete': 'soft-delete-info',
  'missing-original': 'source-info',
  'legacy-audit': 'source-info',
  'soft-delete-mismatch': 'soft-delete-mismatch',
  'duplicate-source': 'duplicate-source',
  'apply-failed': 'apply-failed',
}

const attributionLabels = {
  'source': '来源',
  'mapping': '映射',
  'missing-source': '缺失来源',
  'system': '中央写后核对',
} as const

function evidenceValue(value: number | string | null): string {
  return value === null ? '—' : String(value)
}

const checks = computed(() => {
  if (!store.preflightResult) {
    return [{
      id: 'awaiting-preflight',
      label: '等待运行预检',
      conclusion: 'warning' as MigrationCheckConclusion,
      detail: '未经明确操作不会读取、备份或迁移本地数据。',
    }]
  }
  return [{
    id: 'supported-source',
    label: '来源版本与运行模式',
    conclusion: 'passed' as MigrationCheckConclusion,
    detail: `已确认 ${store.preflightResult.sourceVersion}，共 ${store.preflightResult.entityCount ?? 0} 条受控迁移记录。`,
  }]
})

const backupDisplay = computed(() => store.backup
  ? { id: store.backup.backupId, immutable: true }
  : null)

const reconciliationRows = computed<MigrationReconciliationRowDisplay[]>(() =>
  (store.batch?.issues ?? []).map(issue => ({
    id: issue.id,
    entity: issue.entityType === 'batch' ? '迁移批次' : entityLabels[issue.entityType],
    legacyId: issue.legacyId || '批次级',
    commandId: issue.commandId || null,
    type: issueTypeByMetric[issue.metricKey],
    field: issue.field,
    sourceValue: issue.sourceValue || '—',
    expectedValue: evidenceValue(issue.expectedValue),
    actualValue: evidenceValue(issue.actualValue),
    difference: evidenceValue(issue.difference),
    attribution: attributionLabels[issue.attribution],
    reason: issue.reason,
  })),
)

const centralCounts = computed(() => {
  const counts = Object.fromEntries(
    Object.keys(entityLabels).map(entityType => [entityType, 0]),
  ) as Record<CoreMigrationEntityType, number>
  for (const entity of store.centralSnapshot?.entities ?? [])
    counts[entity.entityType] += 1
  return counts
})

const hasBlockingIssues = computed(() =>
  (store.batch?.issues ?? []).some(isCoreMigrationBlockingIssue),
)
const readyToConfirm = computed(() =>
  store.phase === 'imported' && !hasBlockingIssues.value,
)

const switchStatus = computed<MigrationSwitchStatus>(() => {
  if (store.busy && store.phase === 'confirmed')
    return 'rolling-back'
  if (store.busy && store.phase === 'imported')
    return 'switching'
  if (store.phase === 'confirmed')
    return 'switched'
  if (store.phase === 'rollback-pending')
    return 'rollback-pending'
  if (store.phase === 'rolled-back')
    return 'rolled-back'
  if (store.phase === 'failed')
    return 'failed'
  if (readyToConfirm.value)
    return 'ready'
  return 'pending'
})

function run(action: () => Promise<unknown>) {
  void action().catch(() => undefined)
}

onMounted(() => run(store.hydrate))
</script>

<template>
  <main class="mx-auto grid w-full max-w-1200px min-w-0 gap-4 pb-8" data-testid="core-migration-page">
    <header class="border-b border-line pb-4">
      <p class="m-0 text-11px font-800 tracking-0.12em text-accent uppercase">
        设置 · 数据权威切换
      </p>
      <h1 class="m-0 mt-1 text-24px font-900 tracking-tight text-ink">
        本地数据迁移
      </h1>
      <p class="m-0 mt-2 max-w-820px text-13px leading-6 text-ink-soft">
        按拓扑顺序迁移客户、分供方、班组、项目、工人和项目分供方关系。所有步骤都需要你明确确认，页面不会在启动时静默迁移。
      </p>
    </header>

    <div
      v-if="nativeUnsupported"
      class="border border-warn/35 bg-warn/8 px-4 py-3 text-13px leading-5 text-ink"
      role="status"
    >
      本地快照迁移首版仅支持浏览器工作区；Tauri 桌面端不会读取或修改 IndexedDB 备份。
    </div>

    <div
      v-if="store.lastError"
      class="border border-danger/35 bg-danger/6 px-4 py-3 text-13px leading-5 text-danger"
      role="alert"
    >
      {{ store.lastError.message }}
    </div>

    <p class="m-0 rounded-[var(--radius-control)] border border-warn/35 bg-warn/8 px-4 py-3 text-12px leading-6 text-ink-soft" data-testid="delivery-migration-scope">
      送货范围提示：旧项目别名尚未迁移，原库与不可变备份仍保留；当前项目建议仅取自已人工确认的送货归属。历史原件已有逻辑归属的按字节与摘要保全，无法核实历史祖先或修订关联的仍待人工核对，暂不开放正文。本次不迁移旧到货明细，也不生成库存或材料结算资格。
    </p>

    <MigrationPreflightPanel
      :schema-version="store.source?.sourceVersion ?? '待检测'"
      :mode="store.source?.mode ?? '浏览器正式快照'"
      :checks="checks"
      :backup="backupDisplay"
      :preflight-disabled="nativeUnsupported || store.busy || store.preparationBlocked"
      :create-backup-disabled="store.busy || store.preparationBlocked || !store.preflightResult || Boolean(store.backup)"
      @preflight="run(store.preflight)"
      @create-backup="run(store.createBackup)"
    />

    <section class="panel min-w-0 p-4" aria-labelledby="migration-execution-title">
      <div class="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
        <div>
          <h2 id="migration-execution-title" class="m-0 text-15px font-800 text-ink">
            试运行与导入
          </h2>
          <p class="m-0 mt-1 text-12px leading-5 text-ink-soft">
            dry-run 只生成映射和对账证据；正式导入只处理可安全映射的记录。
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <KitButton
            type="button"
            variant="secondary"
            :disabled="store.busy || store.preparationBlocked || !store.backup"
            @click="run(store.dryRun)"
          >
            执行 dry-run
          </KitButton>
          <KitButton
            type="button"
            variant="primary"
            :disabled="store.busy || store.preparationBlocked || !['dry-run', 'failed'].includes(store.phase) || !store.batch"
            @click="run(store.importBatch)"
          >
            {{ store.phase === 'failed' ? '重试导入可导入记录' : '导入可导入记录' }}
          </KitButton>
        </div>
      </div>

      <div v-if="store.batch" class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="step in store.batch.steps"
          :key="step.entityType"
          class="border border-line bg-surface-2 px-3 py-2"
        >
          <p class="m-0 text-12px font-800 text-ink">
            {{ entityLabels[step.entityType] }}
          </p>
          <p class="m-0 mt-1 text-11px leading-5 text-ink-soft">
            来源 {{ step.sourceCount }} · 可导入 {{ step.importableCount }} · 跳过 {{ step.skippedCount }}
          </p>
        </div>
      </div>
      <p v-else class="m-0 mt-3 text-12px text-ink-soft">
        创建备份后可执行 dry-run。
      </p>
    </section>

    <MigrationReconciliationTable
      :rows="reconciliationRows"
      :state="store.phase === 'rollback-pending'
        ? 'rollback-pending'
        : store.batch
          ? 'checked'
          : store.phase === 'confirmed'
            ? 'verified'
            : 'unchecked'"
    />

    <section class="panel min-w-0 p-4" aria-labelledby="central-snapshot-title">
      <div class="section-heading">
        <h2 id="central-snapshot-title" class="m-0 text-13px font-800 text-ink">
          中央导入快照
        </h2>
      </div>
      <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div
          v-for="(label, entityType) in entityLabels"
          :key="entityType"
          class="border border-line bg-surface-2 px-3 py-2 text-13px font-700 text-ink"
        >
          {{ label }} {{ centralCounts[entityType] }} 条
        </div>
      </div>
    </section>

    <MigrationSwitchPanel
      :status="switchStatus"
      :rollback-expires-at="store.batch?.rollbackExpiresAt ?? store.activeMigration?.rollbackExpiresAt ?? null"
      :preflight-passed="Boolean(store.preflightResult || store.activeMigration)"
      :backup-ready="Boolean(store.backup || store.activeMigration)"
      :reconciliation-passed="readyToConfirm || store.phase === 'confirmed'"
      :busy="store.busy"
      @confirm-switch="run(store.confirmSwitch)"
      @rollback="run(store.rollback)"
    />
  </main>
</template>
