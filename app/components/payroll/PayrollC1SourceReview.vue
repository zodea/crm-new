<script setup lang="ts">
import type { PayrollC1FormRead } from '~/lib/payroll/central-c1-contract'
import type { NavigationIntentDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'
import { c1Number } from '~/lib/payroll/c1-presentation'
import { payrollAmount } from '~/lib/payroll/read-presentation'

const props = defineProps<{ read: PayrollC1FormRead, returnTo: string }>()
const names = computed(() => new Map(props.read.members.map(member => [member.id, member.name || '姓名未记录'])))
function source(intent: NavigationIntentDTO | null) {
  if (!intent)
    return null
  const back = new URL(props.returnTo, 'https://payroll.invalid')
  back.searchParams.set('format', 'C1')
  if (!props.read.statementId) {
    back.searchParams.set('project', props.read.draft.projectId || '')
    back.searchParams.set('month', props.read.draft.month || '')
    if (props.read.draft.crewId)
      back.searchParams.set('crew', props.read.draft.crewId)
    else
      back.searchParams.delete('crew')
  }
  const resolved = resolveNavigationTarget(intent, { returnTo: `${back.pathname}?${back.searchParams}` })
  return resolved.state === 'resolved' ? resolved.to : null
}
const facts = computed(() => props.read.facts.map(fact => ({ ...fact, to: source(props.read.sources.find(intent => intent.kind === 'source-record' && intent.subject.state === 'resolved' && intent.subject.entity === 'attendance' && intent.subject.id === fact.id) || null) })))
const blockers = computed(() => props.read.blockers.map(blocker => ({ ...blocker, to: source(blocker.source) })))
</script>

<template>
  <section id="section-source" class="panel grid min-w-0 gap-4 overflow-hidden p-4" aria-label="C1工资考勤与个人标准">
    <SectionHeader title="本月考勤与个人标准" /><div class="flex flex-wrap items-center gap-3">
      <span class="text-12px text-ink-soft">本月核算应发</span><strong class="font-mono text-20px">{{ payrollAmount(read.totals.grossAmount.value) }}</strong><span v-if="read.totals.grossAmount.state !== 'known'" class="text-12px text-warn">{{ read.totals.grossAmount.reasons.join('；') || '来源待核对' }}</span>
    </div>
    <div class="max-w-full overflow-x-auto">
      <table class="c1-source-table">
        <thead><tr><th>工人</th><th>核算项目</th><th>工时</th><th>每小时标准</th><th>金额</th></tr></thead><tbody>
          <tr v-for="line in read.lines" :key="line.id">
            <td>{{ line.workerName || names.get(line.workerId) }}</td><td>{{ line.itemName }}</td><td>{{ c1Number(line.quantity) }}</td><td>{{ c1Number(line.unitPrice) }}</td><td>{{ payrollAmount(line.amount) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <p class="text-12px leading-5 text-ink-soft">
      正常工时按个人日薪 ÷ 8 核算，加班按个人有效加班价核算。单价保原精度，金额按分保存；无考勤成员保留自己的零行。
    </p>
    <div class="grid gap-3 sm:grid-cols-2">
      <article v-for="rate in read.rates" :key="rate.workerId" class="rounded border border-line p-3 text-12px">
        <h3 class="font-700">
          {{ rate.workerName || names.get(rate.workerId) }}
        </h3><p class="mt-2">
          有效日薪 {{ c1Number(rate.dailyWage) }} 元 · {{ { 'worker-profile': '工人档案', 'payroll-config': '工资配置', 'missing': '未提供' }[rate.dailyWageSource] }}
        </p><p class="mt-1">
          加班 {{ c1Number(rate.overtimeRate) }} 元/小时 · {{ { 'payroll-config': '个人独立配置', 'daily-divided-eight': '日薪 ÷ 8', 'missing': '未提供' }[rate.overtimeRateSource] }}
        </p>
      </article>
    </div>
    <details open class="min-w-0">
      <summary class="cursor-pointer text-13px font-700">
        逐日原考勤（{{ facts.length }} 条）
      </summary><div class="mt-3 max-w-full overflow-x-auto">
        <table class="c1-source-table">
          <thead><tr><th>工人 / 日期</th><th>正常</th><th>加班</th><th>施工内容</th><th>来源</th></tr></thead><tbody>
            <tr v-for="fact in facts" :key="fact.id" :data-attendance-id="fact.id">
              <td>{{ names.get(fact.workerId) || '姓名未记录' }}<br>{{ fact.workDate }}</td><td>{{ c1Number(fact.hours) }}</td><td>{{ c1Number(fact.overtimeHours) }}</td><td class="min-w-48 whitespace-normal break-words">
                {{ fact.workContent || '未记录' }}
              </td><td>
                <NuxtLink v-if="fact.to" :to="fact.to" class="cell--link">
                  查看原考勤
                </NuxtLink><span v-else>来源不可打开</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div><p v-if="!facts.length" class="mt-3 text-12px text-ink-faint">
        当前未取得可用于核算的逐日记录；未登记不等于零工时。
      </p>
    </details>
    <div class="flex flex-wrap gap-2">
      <template v-for="member in read.members" :key="member.id">
        <NuxtLink v-if="source(member.source)" :to="source(member.source)!" class="btn-secondary text-12px">
          {{ member.name || '工人' }}资料
        </NuxtLink>
      </template>
    </div>
    <section v-if="blockers.length" class="grid gap-3 text-12px" aria-label="工资来源缺项">
      <article v-for="(blocker, index) in blockers" :key="index" class="rounded border border-warn/30 bg-warn-soft p-3">
        <p>{{ blocker.message }}</p><p v-if="blocker.workerId" class="mt-1">
          {{ names.get(blocker.workerId) || `原工人 ${blocker.workerId}` }}
        </p><NuxtLink v-if="blocker.to" :to="blocker.to" class="cell--link mt-2 inline-block">
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
.c1-source-table { width:100%; min-width:640px; border-collapse:collapse; font-size:12px; }
th, td { border-bottom:1px solid var(--line); padding:10px 12px; text-align:left; }
th { background:var(--surface-2); white-space:nowrap; }
</style>
