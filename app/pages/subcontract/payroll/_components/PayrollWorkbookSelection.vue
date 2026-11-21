<script setup lang="ts">
import type { PayrollProjectOption, PayrollStatementRow } from '~/lib/payroll/central-contract'
import type { PayrollWorkbookInput } from '~/lib/payroll/central-workbook-contract'
import type { WorkerRosterArchiveSummary } from '~/lib/worker-roster/contract'

defineProps<{
  projectId: string
  projects: PayrollProjectOption[]
  mode: PayrollWorkbookInput['mode']
  subjectKey: string
  subjects: Array<{ key: string, label: string }>
  selected: PayrollStatementRow[]
  rosterArchiveId: string
  rosters: WorkerRosterArchiveSummary[]
  disabled: boolean
  privateReadable: boolean
}>()
const emit = defineEmits<{
  project: [string]
  change: [{ mode?: PayrollWorkbookInput['mode'], subjectKey?: string, rosterArchiveId?: string }]
  preview: []
}>()
</script>

<template>
  <section id="section-scope" class="panel min-w-0 p-4">
    <SectionHeader title="固定工资范围与名册版本" subtitle="工资取原冻结资料；实际收付按保存目录时点保留。后续补退与新资料进入新版本。" />
    <div class="my-4 grid gap-4 sm:grid-cols-2">
      <label class="grid min-w-0 gap-1 text-12px">项目<select aria-label="归档项目" :value="projectId" class="field-input w-full min-w-0" :disabled="disabled" @change="emit('project', ($event.target as HTMLSelectElement).value)"><option value="">请选择项目</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px">输出方式<select aria-label="输出方式" :value="mode" class="field-input w-full min-w-0" :disabled="disabled" @change="emit('change', { mode: ($event.target as HTMLSelectElement).value as PayrollWorkbookInput['mode'] })"><option value="leader-cycle">负责人全周期一册</option><option value="project-month">项目按月 ZIP</option></select></label>
      <label v-if="mode === 'leader-cycle'" class="grid min-w-0 gap-1 text-12px">负责人 / 格式 / 请款簿<select aria-label="负责人请款簿" :value="subjectKey" class="field-input w-full min-w-0" :disabled="disabled" @change="emit('change', { subjectKey: ($event.target as HTMLSelectElement).value })"><option value="">请选择负责人请款簿</option><option v-for="subject in subjects" :key="subject.key" :value="subject.key">{{ subject.label }}</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px">独立名册归档版本<select aria-label="名册归档版本" :value="rosterArchiveId" class="field-input w-full min-w-0" :disabled="disabled || !privateReadable" @change="emit('change', { rosterArchiveId: ($event.target as HTMLSelectElement).value })"><option value="">请选择与工资范围一致的版本</option><option v-for="roster in rosters" :key="roster.id" :value="roster.id">{{ roster.registeredOn }} · 版本 {{ roster.version }} · {{ roster.memberCount }} 人 · {{ roster.gapCount }} 项缺口</option></select></label>
    </div>
    <p v-if="!privateReadable" class="mb-3 text-12px text-warn">
      当前可阅读工资目录；工人私密资料需单独授权，工资权限不包含身份证、银行资料和照片。
    </p>
    <p v-else-if="selected.length && !rosters.length" class="mb-3 text-12px text-warn">
      当前工资范围还没有对应的名册版本。可在实名名册页核对这些原工资成员并归档，再回来选择。
    </p>
    <slot name="roster-link" />
    <div class="mt-4 max-h-64 overflow-auto rounded-md border border-line p-3" tabindex="0" aria-label="所选原工资">
      <p class="mb-2 text-13px font-600">
        本次范围 {{ selected.length }} 份原工资
      </p>
      <p v-for="row in selected" :key="row.id" class="break-words border-t border-line py-2 text-12px">
        {{ row.month }} · {{ row.formatFamily }} · {{ row.leaderName || '姓名未记录' }} · {{ row.book?.bookPurpose === 'management' ? '独立管理费簿' : '普通工资' }}<span class="mt-1 block break-all text-ink-soft">{{ row.id }}</span>
      </p>
    </div>
    <KitButton class="mt-4" :disabled="disabled || !projectId || !selected.length" @click="emit('preview')">
      核对当前范围与固定版本
    </KitButton>
  </section>
</template>
