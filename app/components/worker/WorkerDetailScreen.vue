<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { formatMoney } from '~/lib/util/money'
import { useWorkerDetailStore } from '~/stores/worker-detail'

const route = useRoute()
const store = useWorkerDetailStore()
const workerId = computed(() => String(route.params.id ?? ''))
const detail = computed(() => store.loadedId === workerId.value ? store.current : null)
const state = computed(() => {
  if (store.loading || store.loadedId !== workerId.value)
    return 'loading'
  if (store.error)
    return 'error'
  return detail.value ? 'ready' : 'not-found'
})

useTabTitle(() => detail.value?.worker.name)

watch(workerId, id => void store.load(id), { immediate: true })

function display(value: string | number | null): string {
  return value === '' || value == null ? '—' : String(value)
}

function money(value: number | null): string {
  return value == null ? '历史未记录' : formatMoney(value, { currency: true })
}

function mask(value: string, prefix = 4, suffix = 4): string {
  return value.length > prefix + suffix ? `${value.slice(0, prefix)} **** ${value.slice(-suffix)}` : display(value)
}
</script>

<template>
  <EntityDetailShell
    :title="detail?.worker.name || '工人详情'"
    :subtitle="detail ? `${detail.worker.trade || '未设置工种'} · ${detail.crew?.name || '未加入班组'}` : ''"
    :state="state"
    :state-title="state === 'not-found'
      ? '工人不存在或已删除'
      : state === 'error' ? '工人详情加载失败' : ''"
    :state-description="store.error"
    :state-action-label="state === 'error' ? '重新加载' : ''"
    back-to="/base/worker"
    back-label="返回工人列表"
    aside-label="班组和关联人员"
    @state-action="store.load(workerId)"
  >
    <template #status>
      <span v-if="detail" class="status-chip">{{ detail.worker.status === 'active' ? '在用' : detail.worker.status || '未定状态' }}</span>
    </template>
    <template #actions>
      <NuxtLink v-if="detail" :to="`/base/worker/form/${detail.worker.id}`" class="btn-secondary">
        <span class="i-lucide-pencil mr-1" aria-hidden="true" />编辑
      </NuxtLink>
    </template>
    <template #summary>
      <div v-if="detail" class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <div class="summary-tile">
          <span>参与项目</span><strong>{{ detail.summary.projectCount }}</strong>
        </div>
        <div class="summary-tile">
          <span>责任户</span><strong>{{ detail.summary.assignedUnitCount }}</strong>
        </div>
        <div class="summary-tile">
          <span>考勤</span><strong>{{ detail.summary.attendanceDays }} 天</strong>
        </div>
        <div class="summary-tile">
          <span>确认签工</span><strong>{{ detail.summary.confirmedDayworkUnits }} 工</strong>
        </div>
        <div class="summary-tile">
          <span>已记录个人收款</span><strong>{{ money(detail.summary.knownAllocatedAmount) }}</strong>
        </div>
        <div class="summary-tile">
          <span>工资分配缺失</span><strong>{{ detail.summary.missingAllocationCount }} 份</strong>
        </div>
      </div>
    </template>

    <div v-if="detail" class="grid min-w-0 gap-4">
      <section class="panel min-w-0 p-4" data-testid="worker-profile">
        <SectionHeader title="个人主数据" subtitle="身份、联系方式与用工基础信息" />
        <dl class="detail-grid">
          <div><dt>姓名</dt><dd>{{ detail.worker.name }}</dd></div>
          <div><dt>性别</dt><dd>{{ display(detail.worker.gender) }}</dd></div>
          <div><dt>身份证号</dt><dd>{{ mask(detail.worker.idCard, 6, 4) }}</dd></div>
          <div><dt>联系电话</dt><dd>{{ display(detail.worker.phone) }}</dd></div>
          <div><dt>籍贯</dt><dd>{{ display(detail.worker.hometown) }}</dd></div>
          <div><dt>紧急联系人</dt><dd>{{ display(detail.worker.emergencyContact) }}</dd></div>
          <div><dt>紧急电话</dt><dd>{{ display(detail.worker.emergencyPhone) }}</dd></div>
          <div><dt>所属班组</dt><dd>{{ detail.crew?.name || '未加入班组' }}</dd></div>
          <div><dt>主工种</dt><dd>{{ display(detail.worker.trade) }}</dd></div>
          <div><dt>技能等级</dt><dd>{{ display(detail.worker.skillLevel) }}</dd></div>
          <div><dt>日工资参考</dt><dd>{{ detail.worker.dailyWage == null ? '—' : money(detail.worker.dailyWage) }}</dd></div>
          <div><dt>进 / 退场</dt><dd>{{ display(detail.worker.entryDate) }} / {{ display(detail.worker.exitDate) }}</dd></div>
          <div><dt>安全教育</dt><dd>{{ detail.worker.safetyEducation ? '已完成' : '未记录' }}</dd></div>
          <div><dt>开户行</dt><dd>{{ display(detail.worker.bankName) }}</dd></div>
          <div><dt>银行账号</dt><dd>{{ mask(detail.worker.bankAccount) }}</dd></div>
          <div><dt>备注</dt><dd>{{ display(detail.worker.note) }}</dd></div>
        </dl>
        <h3 class="subheading">
          可做工种与活项
        </h3>
        <div class="flex flex-wrap gap-1.5">
          <span v-for="trade in detail.capabilities.trades" :key="`trade-${trade}`" class="status-chip">{{ trade }}</span>
          <span v-for="item in detail.capabilities.itemNames" :key="`item-${item}`" class="status-chip bg-brand-soft text-brand">{{ item }}</span>
          <span v-if="!detail.capabilities.trades.length && !detail.capabilities.itemNames.length" class="text-12px text-ink-faint">尚未配置</span>
        </div>
        <h3 class="subheading">
          证照与附件
        </h3>
        <ul v-if="detail.attachments.length" class="m-0 grid list-none gap-2 p-0">
          <li v-for="file in detail.attachments" :key="file.id" class="flex min-w-0 items-center gap-2 rounded border border-line px-3 py-2">
            <span class="i-lucide-paperclip shrink-0 text-ink-faint" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-12px">{{ file.fileName }}</span>
            <span class="text-10px text-ink-faint">{{ file.category || '未分类' }}</span>
          </li>
        </ul>
        <p v-else class="empty-copy">
          暂无证照或附件。
        </p>
      </section>

      <section class="panel min-w-0 p-4" data-testid="worker-projects">
        <SectionHeader title="项目与工程量责任" subtitle="项目来源和责任单元均来自现有业务记录" />
        <div v-if="detail.projects.length" class="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <NuxtLink v-for="project in detail.projects" :key="project.id" :to="`/project/${project.id}`" class="rounded border border-line bg-surface-2 p-3 no-underline hover:border-brand">
            <div class="truncate text-13px font-700 text-ink">
              {{ project.name }}
            </div>
            <div class="mt-2 flex flex-wrap gap-1">
              <span v-for="source in project.sources" :key="source" class="status-chip">{{ source }}</span>
            </div>
          </NuxtLink>
        </div>
        <p v-else class="empty-copy">
          暂无当前项目或历史参与记录。
        </p>
        <h3 class="subheading">
          直接责任单元
        </h3>
        <div v-if="detail.assignments.length" class="max-w-full overflow-x-auto" data-testid="worker-assignment-scroll">
          <table class="detail-table min-w-760px">
            <thead><tr><th>项目</th><th>楼栋 / 楼层 / 户</th><th>工种</th><th>责任范围</th><th>完成阶段</th><th>下钻</th></tr></thead>
            <tbody>
              <tr v-for="item in detail.assignments" :key="item.id">
                <td>{{ item.projectName }}</td><td>{{ item.buildingName }} / {{ item.floorName }} / {{ item.unitName }}</td><td>{{ item.trade }}</td><td>{{ item.scopes.map(scope => `${scope.roomName}·${scope.itemName}`).join('；') || '未细分' }}</td><td>{{ item.completedStageCount }}</td><td>
                  <NuxtLink :to="`/subcontract/quantity/${item.projectId}/${item.unitId}`" class="text-brand">
                    户施工详情
                  </NuxtLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="empty-copy">
          暂无直接分配到个人的责任单元。
        </p>
      </section>

      <section class="panel min-w-0 p-4" data-testid="worker-labor-facts">
        <SectionHeader title="考勤、签工与工资事实" subtitle="工资未记录个人分配时，不用整单金额反推" />
        <details open>
          <summary>考勤记录（{{ detail.attendance.length }}）</summary>
          <div v-if="detail.attendance.length" class="table-scroll">
            <table class="detail-table min-w-620px">
              <thead><tr><th>日期</th><th>项目</th><th>工时</th><th>加班</th><th>内容</th></tr></thead><tbody>
                <tr v-for="item in detail.attendance" :key="item.id">
                  <td>{{ item.workDate }}</td><td>{{ item.projectName }}</td><td>{{ item.hours }}</td><td>{{ item.overtimeHours }}</td><td>{{ item.workContent || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty-copy">
            暂无考勤记录。
          </p>
        </details>
        <details class="mt-4">
          <summary>签工记录（{{ detail.daywork.length }}）</summary>
          <div v-if="detail.daywork.length" class="table-scroll">
            <table class="detail-table min-w-680px">
              <thead><tr><th>日期</th><th>项目</th><th>内容</th><th>工数</th><th>见证人</th><th>状态</th></tr></thead><tbody>
                <tr v-for="item in detail.daywork" :key="item.id">
                  <td>{{ item.workDate }}</td><td>{{ item.projectName }}</td><td>{{ item.workContent || '—' }}</td><td>{{ item.laborUnits }}</td><td>{{ item.witness || '—' }}</td><td>{{ item.status === 'confirmed' ? '已确认' : '草稿' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="empty-copy">
            暂无签工记录。
          </p>
        </details>
        <details class="mt-4">
          <summary>工资单关联（{{ detail.wageStatements.length }}）</summary>
          <div v-if="detail.wageStatements.length" class="mt-2 grid gap-2">
            <details v-for="statement in detail.wageStatements" :key="statement.id" class="rounded border border-line p-3">
              <summary>{{ statement.month }} · {{ statement.projectName }} · {{ statement.status }}</summary>
              <div class="mt-2 grid gap-2 text-12px sm:grid-cols-2 lg:grid-cols-4">
                <span>个人清单：<b>{{ money(statement.workerLineAmount) }}</b></span>
                <span>个人收款：<b>{{ money(statement.allocatedAmount) }}</b></span>
                <span>整单毛额：<b>{{ money(statement.statementGrossAmount) }}</b></span>
                <span>口径：<b>{{ statement.quantitySource === 'field' ? '现场复核量' : '暂估量' }}</b></span>
              </div>
              <p v-if="!statement.allocationRecorded" class="m-0 mt-2 text-11px text-warning">
                历史未记录个人分配金额。
              </p>
            </details>
          </div>
          <p v-else class="empty-copy">
            暂无工资单关联。
          </p>
        </details>
      </section>
    </div>

    <template v-if="detail" #aside>
      <div class="grid gap-4">
        <section class="panel p-4">
          <SectionHeader title="所属班组" />
          <template v-if="detail.crew">
            <p class="m-0 text-14px font-700">
              {{ detail.crew.name }}
            </p>
            <p class="m-0 mt-2 text-12px text-ink-soft">
              负责人：{{ detail.crew.contactName || '—' }}
            </p>
            <NuxtLink :to="`/base/crew/${detail.crew.id}`" class="mt-3 inline-flex text-12px text-brand">
              查看班组详情
            </NuxtLink>
          </template>
          <p v-else class="empty-copy">
            未加入班组。
          </p>
        </section>
        <section class="panel p-4">
          <SectionHeader title="亲属与关联人员" />
          <ul v-if="detail.relatedWorkers.length" class="m-0 grid list-none gap-2 p-0">
            <li v-for="person in detail.relatedWorkers" :key="person.id" class="rounded border border-line p-3">
              <NuxtLink :to="`/base/worker/${person.id}`" class="text-12px font-700 text-brand">
                {{ person.name }}
              </NuxtLink>
              <p class="m-0 mt-1 text-11px text-ink-faint">
                {{ person.trade || '未设置工种' }} · {{ person.source === 'family' ? '亲属组' : '历史关联' }}
              </p>
            </li>
          </ul>
          <p v-else class="empty-copy">
            暂无亲属或历史关联。
          </p>
        </section>
      </div>
    </template>
  </EntityDetailShell>
</template>

<style scoped>
.summary-tile { min-width: 0; padding: .65rem .75rem; border-radius: var(--radius-control); background: var(--surface-2); }
.summary-tile span { display: block; color: var(--ink-faint); font-size: 10px; }
.summary-tile strong { display: block; margin-top: .25rem; overflow-wrap: anywhere; font-size: 13px; }
.detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
.detail-grid > div { min-width: 0; padding: .65rem .75rem; border-bottom: 1px solid var(--line); }
dt { color: var(--ink-faint); font-size: 11px; }
dd { margin: .25rem 0 0; overflow-wrap: anywhere; font-size: 12px; font-weight: 600; }
.subheading { margin: 1rem 0 .5rem; padding-top: 1rem; border-top: 1px solid var(--line); font-size: 13px; }
.empty-copy { margin: .5rem 0 0; color: var(--ink-faint); font-size: 12px; }
summary { cursor: pointer; color: var(--ink); font-size: 13px; font-weight: 700; }
.table-scroll { max-width: 100%; margin-top: .5rem; overflow-x: auto; }
.detail-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.detail-table th, .detail-table td { padding: .6rem .7rem; border: 1px solid var(--line); text-align: left; vertical-align: top; }
.detail-table th { background: var(--surface-2); color: var(--ink-soft); }
</style>
