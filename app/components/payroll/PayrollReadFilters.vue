<script setup lang="ts">
import type { PayrollProjectOption } from '~/lib/payroll/central-contract'
import type { PayrollViewScope } from '~/lib/payroll/central-navigation'
import { computed } from 'vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { payrollStatusQuery, payrollStatusSelection } from '~/lib/payroll/central-navigation'

const props = defineProps<{ scope: PayrollViewScope, projects: readonly PayrollProjectOption[], source?: boolean, crews?: readonly { id: string, name: string }[] }>()
const emit = defineEmits<{ change: [patch: Partial<PayrollViewScope>] }>()
const selectedStatuses = computed<string[]>({ get: () => payrollStatusSelection(props.scope.status), set: value => emit('change', { status: payrollStatusQuery(value) }) })
</script>

<template>
  <section class="panel grid min-w-0 grid-cols-1 gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="工资资料筛选">
    <label class="grid min-w-0 gap-1 text-12px text-ink-soft">项目
      <select :value="scope.projectId" class="field-input min-w-0" @change="emit('change', { projectId: ($event.target as HTMLSelectElement).value, crewId: '' })">
        <option value="">{{ source ? '选择来源项目' : '全部项目' }}</option>
        <option v-if="scope.projectId && !projects.some(project => project.id === scope.projectId)" :value="scope.projectId">指定项目尚不可读取</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name || '项目名称未提供' }}{{ project.code ? ` · ${project.code}` : '' }}</option>
      </select>
    </label>
    <label class="grid min-w-0 gap-1 text-12px text-ink-soft">月份<input type="month" class="field-input min-w-0" :value="scope.month" @input="emit('change', { month: ($event.target as HTMLInputElement).value })"></label>
    <label class="grid min-w-0 gap-1 text-12px text-ink-soft">班组
      <select :value="scope.crewId" class="field-input min-w-0" @change="emit('change', { crewId: ($event.target as HTMLSelectElement).value })">
        <option value="">全部班组</option>
        <option v-if="scope.crewId && !crews?.some(crew => crew.id === scope.crewId)" :value="scope.crewId">来源指定班组</option>
        <option v-for="crew in crews || []" :key="crew.id" :value="crew.id">{{ crew.name || '班组名称未记录' }}</option>
      </select>
    </label>
    <label class="grid min-w-0 gap-1 text-12px text-ink-soft">记录范围
      <select :value="scope.deleted" class="field-input min-w-0" @change="emit('change', { deleted: ($event.target as HTMLSelectElement).value })"><option value="">全部历史</option><option value="active">未删除</option><option value="deleted">已删除</option></select>
    </label>
    <template v-if="!source">
      <KitMultiSelectFilter v-model="selectedStatuses" label="工资状态" :options="[{ key: 'draft', label: '草稿' }, { key: 'checked', label: '已核对' }, { key: 'released', label: '已发放' }]" :min-width="0" full-width />
      <label class="grid min-w-0 gap-1 text-12px text-ink-soft">工资格式<select :value="scope.format" class="field-input min-w-0" @change="emit('change', { format: ($event.target as HTMLSelectElement).value })"><option value="">全部格式</option><option v-for="format in ['A', 'C1', 'C2', 'B']" :key="format" :value="format">{{ format === 'B' ? 'B · 退役历史' : format }}</option></select></label>
      <label class="grid min-w-0 gap-1 text-12px text-ink-soft sm:col-span-2">查找负责人或项目<input :value="scope.search" class="field-input min-w-0" placeholder="搜索历史姓名或项目" @input="emit('change', { search: ($event.target as HTMLInputElement).value })"></label>
    </template>
    <label v-if="source" class="grid min-w-0 gap-1 text-12px text-ink-soft">签工确认状态<select :value="scope.dayworkStatus" class="field-input min-w-0" @change="emit('change', { dayworkStatus: ($event.target as HTMLSelectElement).value })"><option value="">全部确认状态</option><option value="draft">待确认</option><option value="confirmed">已确认</option></select></label>
  </section>
</template>
