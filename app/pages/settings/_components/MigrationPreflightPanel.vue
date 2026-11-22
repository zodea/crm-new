<script setup lang="ts">
export type MigrationCheckConclusion = 'passed' | 'warning' | 'blocked'

export interface MigrationPreflightCheckDisplay {
  id: string
  label: string
  conclusion: MigrationCheckConclusion
  detail: string
}

export interface MigrationBackupDisplay {
  id: string
  immutable: boolean
}

withDefaults(defineProps<{
  schemaVersion: string
  mode: string
  checks: readonly MigrationPreflightCheckDisplay[]
  backup: MigrationBackupDisplay | null
  preflightDisabled?: boolean
  createBackupDisabled?: boolean
}>(), {
  preflightDisabled: false,
  createBackupDisabled: false,
})

defineEmits<{
  preflight: []
  createBackup: []
}>()

const conclusionLabels: Record<MigrationCheckConclusion, string> = {
  passed: '通过',
  warning: '需确认',
  blocked: '阻塞',
}

const conclusionClasses: Record<MigrationCheckConclusion, string> = {
  passed: 'chip-ok',
  warning: 'chip-warn',
  blocked: 'chip-danger',
}
</script>

<template>
  <section class="panel min-w-0 p-4" role="region" aria-label="迁移预检">
    <div class="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3">
      <div>
        <h2 class="m-0 text-15px font-800 text-ink">
          迁移预检
        </h2>
        <p class="m-0 mt-1 text-12px leading-5 text-ink-soft">
          先确认旧库版本与运行模式，再创建可恢复备份。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn-secondary"
          :disabled="preflightDisabled"
          @click="$emit('preflight')"
        >
          运行预检
        </button>
        <button
          type="button"
          class="btn-primary"
          :disabled="createBackupDisabled"
          @click="$emit('createBackup')"
        >
          创建不可变备份
        </button>
      </div>
    </div>

    <dl class="info-row mt-3">
      <div class="info-cell">
        <dt class="text-11px text-ink-faint">
          旧库 Schema
        </dt>
        <dd class="m-0 mt-1 font-mono text-13px font-700 text-ink">
          {{ schemaVersion }}
        </dd>
      </div>
      <div class="info-cell">
        <dt class="text-11px text-ink-faint">
          迁移模式
        </dt>
        <dd class="m-0 mt-1 text-13px font-700 text-ink">
          {{ mode }}
        </dd>
      </div>
      <div class="info-cell">
        <dt class="text-11px text-ink-faint">
          可恢复备份
        </dt>
        <dd v-if="backup" class="m-0 mt-1 flex flex-wrap items-center gap-2 text-13px text-ink">
          <span class="font-mono font-700">{{ backup.id }}</span>
          <span v-if="backup.immutable" class="chip-brand">不可变备份</span>
          <span v-else class="chip-warn">尚未锁定</span>
        </dd>
        <dd v-else class="m-0 mt-1 text-13px text-ink-soft">
          尚未创建可恢复备份
        </dd>
      </div>
    </dl>

    <ul class="m-0 mt-3 grid list-none gap-2 p-0" aria-label="预检结论">
      <li
        v-for="check in checks"
        :key="check.id"
        class="flex min-w-0 flex-wrap items-start gap-2 border border-line bg-surface-2 px-3 py-2"
      >
        <span :class="conclusionClasses[check.conclusion]">
          {{ conclusionLabels[check.conclusion] }}
        </span>
        <div class="min-w-0 flex-1">
          <p class="m-0 text-13px font-700 text-ink">
            {{ check.label }}
          </p>
          <p class="m-0 mt-0.5 break-words text-12px leading-5 text-ink-soft">
            {{ check.detail }}
          </p>
        </div>
      </li>
    </ul>
  </section>
</template>
