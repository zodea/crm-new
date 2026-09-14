<script setup lang="ts">
import { computed } from 'vue'
import LookupSelect from '~/components/ui/LookupSelect.vue'
import { useCentralDaywork } from '~/composables/useCentralDaywork'
import { payrollC2Lookup } from '~/lib/payroll/c2-presentation'
import { payrollReadLocation, payrollSourceReturnTo, payrollViewQuery } from '~/lib/payroll/central-navigation'
import { generateId } from '~/lib/util/id'

const route = useRoute()
const ui = useCentralDaywork()
const { current, loading, error, scope, canWrite, confirmation, commandError, focused, focusError, active } = ui
const projects = computed(() => payrollC2Lookup(current.value?.options.projects || []))
const crews = computed(() => payrollC2Lookup(current.value?.options.crews || []))
const create = computed(() => ({ path: '/subcontract/daywork/new', query: { ...payrollViewQuery(scope.value), draftKey: generateId('daywork-draft'), returnTo: ui.returnTo.value } }))
const wage = computed(() => ({ path: '/subcontract/payroll/new', query: { ...payrollViewQuery(scope.value), format: 'C2', draftKey: generateId('payroll-c2-draft'), returnTo: ui.returnTo.value } }))
function state(value: string, checked: boolean) {
  const previous = ui.dayworkStatuses.value
  const selected = checked ? [...new Set([...previous, value])] : previous.filter(item => item !== value)
  void ui.filter('dayworkStatus', selected.length ? JSON.stringify(selected) : '')
}
useTabTitle('零星签工')
</script>

<template>
  <main class="grid min-w-0 gap-4">
    <header class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p class="text-11px font-700 text-brand">
          工资来源
        </p><h1 class="mt-1 text-20px font-800">
          零星签工
        </h1><p class="mt-2 text-12px text-ink-soft">
          逐日用工记录与真实证明；待确认不计薪，已发来源不能改写。
        </p>
      </div><div class="flex flex-wrap gap-2">
        <NuxtLink v-if="canWrite" :to="create" class="btn-primary">
          新增签工记录
        </NuxtLink><NuxtLink v-if="canWrite" :to="wage" class="btn-secondary">
          新建 C2 工资草稿
        </NuxtLink><NuxtLink :to="payrollSourceReturnTo(route.query.returnTo, scope)" class="btn-secondary">
          返回工资核算
        </NuxtLink><NuxtLink :to="payrollReadLocation('/subcontract/attendance', scope)" class="btn-secondary">
          打开考勤
        </NuxtLink>
      </div>
    </header>
    <PayrollC2SourceReturn v-if="route.query.payrollFormat === 'C2' && typeof route.query.record === 'string' && scope.origin" kind="daywork" :source-id="route.query.record" :project-id="scope.projectId" :origin="scope.origin" />
    <section class="panel grid min-w-0 gap-4 p-4 sm:grid-cols-2" aria-label="签工筛选">
      <label class="grid min-w-0 gap-1 text-12px">项目<LookupSelect :model-value="scope.projectId || null" :fetch="projects" placeholder="签工筛选项目" @update:model-value="ui.filter('project', $event || '')" /></label><label class="grid min-w-0 gap-1 text-12px">月份<input :value="scope.month" type="month" aria-label="签工月份" class="field-input min-w-0" @change="ui.filter('month', ($event.target as HTMLInputElement).value)"></label><label class="grid min-w-0 gap-1 text-12px">班组<LookupSelect :model-value="scope.crewId || null" :fetch="crews" placeholder="全部班组" @update:model-value="ui.filter('crew', $event || '')" /></label><fieldset class="flex flex-wrap gap-3 text-12px">
        <legend class="mb-2 font-700">
          签工确认状态
        </legend><label><input type="checkbox" :checked="scope.dayworkStatus.includes('draft')" @change="state('draft', ($event.target as HTMLInputElement).checked)"> 待确认</label><label><input type="checkbox" :checked="scope.dayworkStatus.includes('confirmed')" @change="state('confirmed', ($event.target as HTMLInputElement).checked)"> 已确认</label>
      </fieldset>
    </section>
    <p v-if="loading" role="status" class="panel p-4 text-13px">
      正在读取签工原资料…
    </p><section v-if="error || commandError || focusError" role="alert" class="panel grid gap-2 p-4 text-13px text-danger">
      <p>{{ error || commandError || focusError }}</p><KitButton @click="ui.load">
        重新读取
      </KitButton>
    </section>
    <template v-if="current">
      <p v-if="!scope.projectId || !scope.month" class="panel p-4 text-13px">
        请选择项目和月份，查看该范围的签工；不会自动选择其他项目。
      </p><p v-else-if="!current.records.length" class="panel p-4 text-13px">
        当前筛选没有签工记录。尚未登记不等于已经完成或确认。
      </p><p v-if="!canWrite" class="text-12px text-ink-soft">
        当前来源或身份仅供只读核对。
      </p><PayrollDayworkTable v-if="current.records.length" :records="current.records" :origin="current.context.origin" :return-to="ui.returnTo.value" :writable="canWrite" :focused-id="focused?.id" @confirm="ui.confirm" /><PayrollDayworkLocks :locks="current.locks" :workers="current.options.workers" /><p v-for="(item, index) in current.diagnostics" :key="index" class="text-12px text-warn">
        {{ item.message }}
      </p><PayrollSourceEvidence :evidence="current.evidence" />
    </template>
    <PayrollDayworkConfirmDialog v-if="confirmation" :key="confirmation.recordId!" :read="confirmation" :open="active" @close="ui.closeConfirmation" @changed="ui.load" />
  </main>
</template>
