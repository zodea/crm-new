<script setup lang="ts">
export type MigrationReconciliationType
  = | 'missing-relation'
    | 'count-mismatch'
    | 'amount-mismatch'
    | 'reference-mismatch'
    | 'soft-delete-info'
    | 'source-info'
    | 'soft-delete-mismatch'
    | 'orphan'
    | 'duplicate-source'
    | 'apply-failed'

export interface MigrationReconciliationRowDisplay {
  id: string
  entity: string
  legacyId: string
  commandId: string | null
  type: MigrationReconciliationType
  field: string
  sourceValue: string
  expectedValue: string
  actualValue: string
  difference: string
  attribution: string
  reason: string
}

defineProps<{
  rows: readonly MigrationReconciliationRowDisplay[]
  state: 'unchecked' | 'checked' | 'verified' | 'rollback-pending'
}>()

const typeLabels: Record<MigrationReconciliationType, string> = {
  'missing-relation': '缺失关系',
  'count-mismatch': '数量不一致',
  'amount-mismatch': '金额不一致',
  'reference-mismatch': '引用不一致',
  'soft-delete-info': '已保留软删除',
  'source-info': '来源缺失或历史留痕',
  'soft-delete-mismatch': '软删除不一致',
  'orphan': '孤儿记录',
  'duplicate-source': '来源重复',
  'apply-failed': '导入失败',
}

const typeClasses: Record<MigrationReconciliationType, string> = {
  'missing-relation': 'chip-danger',
  'count-mismatch': 'chip-warn',
  'amount-mismatch': 'chip-warn',
  'reference-mismatch': 'chip-danger',
  'soft-delete-info': 'chip-ok',
  'source-info': 'chip-warn',
  'soft-delete-mismatch': 'chip-warn',
  'orphan': 'chip-danger',
  'duplicate-source': 'chip-danger',
  'apply-failed': 'chip-danger',
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="migration-reconciliation-title">
    <div class="section-heading justify-between">
      <h2 id="migration-reconciliation-title" class="m-0 text-13px font-800 text-ink">
        迁移对账
      </h2>
      <span class="text-12px text-ink-soft">{{ rows.length }} 条对账记录</span>
    </div>

    <div v-if="state === 'rollback-pending'" class="flex min-h-28 items-center justify-center px-4 py-6 text-center" role="status">
      <div>
        <span class="i-lucide-rotate-ccw text-22px text-warn" aria-hidden="true" />
        <p class="m-0 mt-2 text-13px font-700 text-ink">
          中央已回滚，等待恢复本地快照
        </p>
        <p class="m-0 mt-1 text-12px text-ink-soft">
          历史对账已经完成；请重试回滚以恢复受保护备份。
        </p>
      </div>
    </div>

    <div v-if="rows.length" class="max-w-full overflow-x-auto" data-testid="migration-reconciliation-scroll">
      <table class="w-full min-w-1500px border-collapse text-left text-12px" aria-label="迁移对账问题">
        <thead class="bg-surface-2 text-ink-soft">
          <tr>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              实体
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              旧 ID
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              命令
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              类型
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              字段
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              来源值
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              期望值
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              实际值
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              差异
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              归因
            </th>
            <th scope="col" class="border-b border-line px-3 py-2 font-700">
              原因
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.id" class="border-b border-line last:border-b-0">
            <td class="whitespace-nowrap px-3 py-2 font-700 text-ink">
              {{ row.entity }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ row.legacyId }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ row.commandId || '未生成' }}
            </td>
            <td class="whitespace-nowrap px-3 py-2">
              <span :class="typeClasses[row.type]">{{ typeLabels[row.type] }}</span>
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ row.field }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ row.sourceValue }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ row.expectedValue }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ row.actualValue }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 font-mono text-ink-soft">
              {{ row.difference }}
            </td>
            <td class="whitespace-nowrap px-3 py-2 text-ink-soft">
              {{ row.attribution }}
            </td>
            <td class="min-w-260px break-words px-3 py-2 leading-5 text-ink-soft">
              {{ row.reason }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-else-if="state === 'checked'" class="flex min-h-28 items-center justify-center px-4 py-6 text-center" role="status">
      <div>
        <span class="i-lucide-circle-check-big text-22px text-ok" aria-hidden="true" />
        <p class="m-0 mt-2 text-13px font-700 text-ink">
          对账通过，未发现迁移差异
        </p>
        <p class="m-0 mt-1 text-12px text-ink-soft">
          数量、金额、引用、软删除和孤儿检查均无待处理项。
        </p>
      </div>
    </div>
    <div v-else-if="state === 'verified'" class="flex min-h-28 items-center justify-center px-4 py-6 text-center" role="status">
      <div>
        <span class="i-lucide-shield-check text-22px text-ok" aria-hidden="true" />
        <p class="m-0 mt-2 text-13px font-700 text-ink">
          中央切换前已完成对账
        </p>
        <p class="m-0 mt-1 text-12px text-ink-soft">
          刷新后未恢复历史明细；批次与本机回滚标记仍已核验一致。
        </p>
      </div>
    </div>
    <div v-else-if="state === 'unchecked'" class="flex min-h-28 items-center justify-center px-4 py-6 text-center" role="status">
      <div>
        <span class="i-lucide-clock-3 text-22px text-ink-muted" aria-hidden="true" />
        <p class="m-0 mt-2 text-13px font-700 text-ink">
          尚未执行迁移对账
        </p>
        <p class="m-0 mt-1 text-12px text-ink-soft">
          完成不可变备份并运行 dry-run 后，这里才会显示对账结论。
        </p>
      </div>
    </div>
  </section>
</template>
