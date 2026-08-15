<script setup lang="ts">
import { computed } from 'vue'

export type MigrationSwitchStatus
  = | 'pending'
    | 'ready'
    | 'switching'
    | 'switched'
    | 'rolling-back'
    | 'rollback-pending'
    | 'rolled-back'
    | 'rollback-expired'
    | 'failed'

const props = withDefaults(defineProps<{
  status: MigrationSwitchStatus
  rollbackExpiresAt: string | null
  preflightPassed: boolean
  backupReady: boolean
  reconciliationPassed: boolean
  busy?: boolean
}>(), {
  busy: false,
})

defineEmits<{
  confirmSwitch: []
  rollback: []
}>()

const statusLabels: Record<MigrationSwitchStatus, string> = {
  'pending': '等待迁移前置步骤',
  'ready': '待确认切换',
  'switching': '正在切换中央后台',
  'switched': '已切换中央后台',
  'rolling-back': '正在回滚本地快照',
  'rollback-pending': '中央已回滚，待恢复本地快照',
  'rolled-back': '已回滚本地快照',
  'rollback-expired': '回滚窗口已关闭',
  'failed': '切换失败',
}

const statusClasses: Record<MigrationSwitchStatus, string> = {
  'pending': 'chip-warn',
  'ready': 'chip-brand',
  'switching': 'chip-brand',
  'switched': 'chip-ok',
  'rolling-back': 'chip-warn',
  'rollback-pending': 'chip-warn',
  'rolled-back': 'chip-warn',
  'rollback-expired': 'chip-warn',
  'failed': 'chip-danger',
}

const switchDisabled = computed(() => props.busy
  || props.status !== 'ready'
  || !props.preflightPassed
  || !props.backupReady
  || !props.reconciliationPassed)

const rollbackDisabled = computed(() => props.busy
  || (props.status !== 'switched' && props.status !== 'rollback-pending')
  || !props.rollbackExpiresAt)
</script>

<template>
  <section class="panel min-w-0 p-4" role="region" aria-label="中央后台切换">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
      <div>
        <h2 class="m-0 text-15px font-800 text-ink">
          中央后台切换
        </h2>
        <p class="m-0 mt-1 text-12px leading-5 text-ink-soft">
          确认后正式读写只走中央后台；回滚窗口内仍可恢复受保护快照。
        </p>
      </div>
      <span :class="statusClasses[status]">{{ statusLabels[status] }}</span>
    </div>

    <ul class="m-0 mt-3 grid list-none gap-2 p-0 sm:grid-cols-3" aria-label="切换前置条件">
      <li class="border border-line bg-surface-2 px-3 py-2">
        <span :class="preflightPassed ? 'status-ok' : 'status-danger'">
          {{ preflightPassed ? '预检已通过' : '预检未通过' }}
        </span>
      </li>
      <li class="border border-line bg-surface-2 px-3 py-2">
        <span :class="backupReady ? 'status-ok' : 'status-danger'">
          {{ backupReady ? '备份已锁定' : '备份未锁定' }}
        </span>
      </li>
      <li class="border border-line bg-surface-2 px-3 py-2">
        <span :class="reconciliationPassed ? 'status-ok' : 'status-danger'">
          {{ reconciliationPassed ? '对账已通过' : '对账未通过' }}
        </span>
      </li>
    </ul>

    <div class="mt-3 border border-line bg-surface-2 px-3 py-2">
      <p class="m-0 text-11px text-ink-faint">
        回滚窗口截止时间
      </p>
      <time
        v-if="rollbackExpiresAt"
        :datetime="rollbackExpiresAt"
        class="mt-1 block break-words font-mono text-13px font-700 text-ink"
      >
        {{ rollbackExpiresAt }}
      </time>
      <p v-else class="m-0 mt-1 text-13px text-ink-soft">
        尚未进入回滚窗口
      </p>
    </div>

    <div class="mt-4 flex flex-wrap justify-end gap-2">
      <button
        type="button"
        class="btn-danger"
        :disabled="rollbackDisabled"
        @click="$emit('rollback')"
      >
        回滚到本地快照
      </button>
      <button
        type="button"
        class="btn-accent"
        :disabled="switchDisabled"
        @click="$emit('confirmSwitch')"
      >
        确认切换中央后台
      </button>
    </div>
  </section>
</template>
