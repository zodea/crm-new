<script setup lang="ts">
import type { PayrollC2FormRead } from '~/lib/payroll/central-c2-contract'
import type { NavigationIntentDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { c2Number, dayworkState } from '~/lib/payroll/c2-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ read: PayrollC2FormRead, returnTo: string }>()
const names = computed(() => new Map(props.read.members.map(member => [member.id, member.name || '姓名未记录'])))
function source(intent: NavigationIntentDTO | null) {
  if (!intent)
    return null
  const back = new URL(props.returnTo, 'https://payroll.invalid')
  back.searchParams.set('format', 'C2')
  if (!props.read.statementId) {
    back.searchParams.set('project', props.read.draft.projectId || '')
    back.searchParams.set('month', props.read.draft.month || '')
    if (props.read.draft.crewId)
      back.searchParams.set('crew', props.read.draft.crewId)
    else back.searchParams.delete('crew')
  }
  const resolved = resolveNavigationTarget(intent, { returnTo: `${back.pathname}?${back.searchParams}` })
  return resolved.state === 'resolved' ? resolved.to : null
}
const facts = computed(() => props.read.facts.map(fact => ({ ...fact, adopted: props.read.adoptedRecordIds.includes(fact.id), to: source(fact.source) })))
</script>

<template>
  <section id="section-source" class="panel grid min-w-0 gap-4 overflow-hidden p-4" aria-label="C2工资签工与主体标准">
    <SectionHeader title="本月签工与主体标准" />
    <div class="flex flex-wrap items-center gap-3">
      <span class="text-12px text-ink-soft">本月核算应发</span><strong class="font-mono text-20px">{{ payrollAmount(read.totals.grossAmount.value) }}</strong><span v-if="read.totals.grossAmount.state !== 'known'" class="text-12px text-warn">{{ read.totals.grossAmount.reasons.join('；') || '来源待核对' }}</span>
    </div>
    <article class="rounded border border-line p-3 text-12px" aria-label="当前主体签工标准">
      <p>每工标准 {{ c2Number(read.config?.unitRate ?? null) }} 元</p><p class="mt-2 whitespace-pre-wrap break-words">
        计算规则：{{ read.config?.ruleText == null ? '历史规则未记录' : read.config.ruleText === '' ? '已明确保存为空规则' : read.config.ruleText }}
      </p>
    </article>
    <div class="max-w-full overflow-x-auto">
      <table class="c2-source-table">
        <thead><tr><th>工人</th><th>核算项目</th><th>工</th><th>元/工</th><th>金额</th></tr></thead><tbody>
          <tr v-for="line in read.lines" :key="line.id">
            <td>{{ line.workerName || names.get(line.workerId) }}</td><td>{{ line.itemName }}</td><td>{{ c2Number(line.quantity) }}</td><td>{{ c2Number(line.unitPrice) }}</td><td>{{ payrollAmount(line.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-12px leading-5 text-ink-soft">
      采用本月已确认且可用的签工，按主体每工标准核算，月度 100%。待确认记录不计薪；无签工成员仍保留在收款分配中。
    </p>
    <details open class="min-w-0">
      <summary class="cursor-pointer text-13px font-700">
        逐条原签工（{{ facts.length }} 条）
      </summary><div class="mt-3 max-w-full overflow-x-auto">
        <table class="c2-source-table">
          <thead><tr><th>工人 / 日期</th><th>时段 / 工</th><th>施工内容</th><th>证明 / 确认</th><th>本单采用</th><th>来源</th></tr></thead><tbody>
            <tr v-for="fact in facts" :key="fact.id" :data-daywork-id="fact.id">
              <td>{{ fact.workerName || names.get(fact.workerId) || '姓名未记录' }}<br>{{ fact.workDate }}</td><td>{{ fact.startTime ?? '未记录' }}—{{ fact.endTime ?? '未记录' }}<br>{{ c2Number(fact.laborUnits) }} 工</td><td class="min-w-48 whitespace-normal break-words">
                {{ fact.workContent || '未记录' }}
              </td><td>{{ fact.witness || '证明人未记录' }}<br>{{ fact.confirmedOn || '确认日期未记录' }}<br>{{ dayworkState(fact.status) }}</td><td>
                {{ fact.adopted ? '已采用' : '未采用' }}<p v-for="issue in fact.diagnostics" :key="issue.code" class="mt-1 text-warn">
                  {{ issue.message }}
                </p><p v-for="reason in fact.eligibility.reasons" :key="reason" class="text-warn">
                  {{ reason }}
                </p>
              </td><td>
                <NuxtLink v-if="fact.to" :to="fact.to" class="cell--link">
                  查看原签工
                </NuxtLink><span v-else>来源不可打开</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div><p v-if="!facts.length" class="mt-3 text-12px text-ink-faint">
        当前没有可读取的本月签工记录。
      </p>
    </details>
    <details v-if="read.storedSource" class="min-w-0 text-12px">
      <summary>查看上次核对保存的依据</summary><p class="mt-2">
        原每工标准 {{ c2Number(read.storedSource.config.unitRate) }}；原规则 {{ read.storedSource.config.ruleText == null ? '未记录' : read.storedSource.config.ruleText === '' ? '明确为空' : read.storedSource.config.ruleText }}
      </p><ul class="mt-2 grid gap-2">
        <li v-for="fact in read.storedSource.facts" :key="fact.id">
          {{ read.storedSource.members.find(member => member.workerId === fact.workerId)?.workerName || '姓名未记录' }} · {{ fact.workDate }} · {{ c2Number(fact.laborUnits) }} 工 · {{ fact.workContent }} · 证明人 {{ fact.witness || '未记录' }}
        </li>
      </ul>
    </details>
    <div class="flex flex-wrap gap-2">
      <template v-for="member in read.members" :key="member.id">
        <NuxtLink v-if="source(member.source)" :to="source(member.source)!" class="btn-secondary text-12px">
          {{ member.name || '工人' }}资料
        </NuxtLink>
      </template>
    </div>
    <section v-if="read.blockers.length" class="grid gap-3 text-12px" aria-label="工资来源缺项">
      <article v-for="(blocker, index) in read.blockers" :key="index" class="rounded border border-warn/30 bg-warn-soft p-3">
        <p>{{ blocker.message }}</p><p v-if="blocker.workerId" class="mt-1">
          {{ names.get(blocker.workerId) || `原工人 ${blocker.workerId}` }}
        </p><NuxtLink v-if="source(blocker.source)" :to="source(blocker.source)!" class="cell--link mt-2 inline-block">
          查看原来源
        </NuxtLink><details v-if="blocker.recordId || blocker.statementId" class="mt-2">
          <summary>原记录身份</summary><p class="break-all">
            {{ blocker.recordId || blocker.statementId }}
          </p>
        </details>
      </article>
    </section>
  </section>
</template>

<style scoped>
.c2-source-table { width:100%; min-width:640px; border-collapse:collapse; font-size:12px; }
th, td { border-bottom:1px solid var(--line); padding:10px 12px; text-align:left; vertical-align:top; }
th { background:var(--surface-2); white-space:nowrap; }
</style>
