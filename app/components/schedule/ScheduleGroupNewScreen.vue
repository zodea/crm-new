<script setup lang="ts">
import ScheduleCommandRecovery from '~/components/schedule/ScheduleCommandRecovery.vue'
import { useScheduleGroupWizard } from '~/composables/useScheduleGroupWizard'
import { processLibraryNavigationQuery } from '~/lib/schedule/process-library-navigation'

const { store, cancel, projectId, contractId, scopeBasis, processLibraryId, name, startDate, overlapMode, buildingIds, tasks, initialized, loadingRange, loadError, currentStep, libraryOrigin, libraryReturnTo, templateByKey, plannedRows, planByKey, ganttRows, enabledCount, finishDate, projectOptions, contractOptions, processLibraryOptions, activeProcessLibrary, coverageSummary, outsideBuildingNames, disabledConflictCount, wizardSteps, confirmationBlockers, provisionalRangeBlockers, coverageReview, nextStep, previousStep, predecessorLabel, updateTaskWindow, updateTaskDuration, updateTaskAnchor, toggleBuilding, provisionalBuildingStatus, saveDraftForRegion, toggleAllTasks, submit, initialize, canWrite, submitError, draftNotice, confirming, recheck, recoverPending } = useScheduleGroupWizard()
</script>

<template>
  <div class="schedule-new flex min-w-0 flex-col gap-4">
    <header class="panel flex items-center gap-3 p-4">
      <button type="button" class="icon-btn" aria-label="返回施工进度" :disabled="store.saving || Boolean(store.pendingCommand)" @click="cancel">
        <span class="i-lucide-arrow-left" />
      </button>
      <div class="min-w-0 flex-1">
        <div class="text-11px font-700 text-brand">
          新建排程
        </div>
        <h1 class="text-18px font-850 text-ink">
          楼栋分组与标准工序
        </h1>
      </div>
    </header>

    <ScheduleCommandRecovery v-if="store.pendingCommand" :busy="store.saving" @recover="recoverPending" @recheck="recheck" />
    <p v-if="draftNotice" class="panel p-3 text-12px text-warning" role="status">
      {{ draftNotice }}
    </p>
    <section v-if="submitError" class="panel grid gap-2 p-3 text-12px text-danger" role="alert">
      <p>{{ submitError }}</p><button type="button" class="btn-secondary w-fit" :disabled="store.saving" @click="recheck">
        保留草稿，重新核对资料
      </button>
    </section>
    <nav v-if="!loadError" class="wizard-stepper panel" aria-label="新建排程步骤">
      <div
        v-for="item in wizardSteps"
        :key="item.step"
        class="wizard-step"
        :class="{
          'is-active': currentStep === item.step,
          'is-complete': currentStep > item.step,
        }"
        :aria-current="currentStep === item.step ? 'step' : undefined"
      >
        <span class="wizard-step__index">
          {{ currentStep > item.step ? '✓' : item.step }}
        </span>
        <span class="min-w-0">
          <b>{{ item.label }}</b>
          <small>{{ item.hint }}</small>
        </span>
      </div>
    </nav>

    <section
      v-if="loadError"
      class="panel grid min-h-56 place-items-center p-5 text-center"
      role="alert"
    >
      <div class="max-w-xl">
        <span class="i-lucide-circle-alert text-24px text-danger" aria-hidden="true" />
        <h2 class="mt-2 text-14px font-800 text-ink">
          排程向导加载失败
        </h2>
        <p class="mt-1 text-12px text-danger">
          {{ loadError }}
        </p>
        <button type="button" class="btn-primary mt-3" @click="initialize">
          重新加载
        </button>
      </div>
    </section>

    <section
      v-else-if="currentStep === 1"
      class="panel mx-auto w-full max-w-5xl p-4 sm:p-5"
      :inert="!initialized || loadingRange || store.saving || Boolean(store.pendingCommand) || confirming"
      data-schedule-wizard-step="1"
    >
      <header>
        <h2 class="text-15px font-850 text-ink">
          确定排程范围
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          先确定项目、合同或内部暂估依据和楼栋；工序放到下一步处理。
        </p>
      </header>
      <div class="range-grid mt-5">
        <div class="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
          <div>
            <span class="field-label block">项目</span>
            <SelectFilter v-model="projectId" aria-label="项目" :options="projectOptions" :min-width="210" placeholder="选择项目" :disabled="!initialized || loadingRange" full-width />
          </div>
          <label>
            <span class="field-label block">分组名称</span>
            <input v-model="name" class="field-input w-full" maxlength="80" :disabled="!initialized || loadingRange">
          </label>
          <fieldset class="min-w-0">
            <legend class="field-label">
              范围依据
            </legend>
            <div class="mt-1 grid gap-2 sm:grid-cols-2">
              <label class="scope-option" :class="scopeBasis === 'contract' && 'is-active'">
                <input v-model="scopeBasis" type="radio" value="contract" class="accent-[var(--brand)]">
                <span><b>合同清单</b><small>按已确认清单控范围</small></span>
              </label>
              <label class="scope-option" :class="scopeBasis === 'provisional' && 'is-active'">
                <input v-model="scopeBasis" type="radio" value="provisional" class="accent-[var(--brand)]">
                <span><b>内部暂估</b><small>合同未签也可先排计划</small></span>
              </label>
            </div>
          </fieldset>
          <div v-if="scopeBasis === 'contract'">
            <span class="field-label block">施工合同</span>
            <SelectFilter v-model="contractId" aria-label="施工合同" :options="contractOptions" :min-width="210" placeholder="选择施工合同" :disabled="!initialized || loadingRange" full-width />
            <span v-if="!store.contracts.length" class="mt-1 block text-11px text-danger">
              当前项目尚未配置施工合同。
            </span>
            <span v-else-if="store.contracts.every(contract => !contract.lineCount)" class="mt-1 block text-11px text-warning">
              合同尚未导入清单；请先拆表确认楼栋范围后再建组。
            </span>
          </div>
          <div v-else class="rounded-lg border border-warning/30 bg-warning/8 p-3 text-11px text-ink-soft">
            <b class="block text-warning">待绑定合同</b>
            范围读取项目手工楼栋，工程量读取户型模板暂估量，不会标记为合同确认值。
            <NuxtLink
              :to="{ path: '/subcontract/quantity', query: { project: projectId || undefined, origin: libraryOrigin } }"
              class="mt-1 block font-700 text-brand hover:underline"
            >
              打开工程量管理，维护暂估量 →
            </NuxtLink>
          </div>
        </div>

        <fieldset class="min-w-0 rounded-lg border border-line p-3">
          <legend class="px-1 text-12px font-800 text-ink">
            楼栋范围
          </legend>
          <div v-if="scopeBasis === 'contract' && store.buildingCoverage.length" class="flex flex-wrap gap-1.5 text-10px">
            <span class="chip-brand">合同范围 {{ coverageSummary.contract }}</span>
            <span class="chip-ok">未纳入 {{ coverageSummary.available }}</span>
            <span class="chip">已纳入 {{ coverageSummary.scheduled }}</span>
            <span v-if="coverageSummary.outside" class="chip-warn">超合同范围 {{ coverageSummary.outside }}</span>
          </div>
          <div v-if="store.buildings.length" class="building-grid mt-2 max-h-92 overflow-y-auto pr-1">
            <label v-for="building in store.buildings" :key="building.id" class="flex min-w-0 items-start gap-2 rounded px-2 py-2 text-12px hover:bg-surface-2">
              <input :checked="buildingIds.includes(building.id)" :disabled="loadingRange" type="checkbox" class="shrink-0 accent-[var(--brand)]" @change="toggleBuilding(building.id)">
              <span class="min-w-0 flex-1">
                <span class="flex min-w-0 items-center gap-2">
                  <b class="min-w-0 truncate font-700 text-ink">{{ building.name }}</b>
                  <span class="shrink-0 text-ink-faint">{{ building.code }}</span>
                </span>
                <small
                  v-if="scopeBasis === 'provisional'"
                  class="mt-0.5 block"
                  :class="provisionalBuildingStatus(building.id).blocked ? 'text-danger' : 'text-ink-faint'"
                >
                  {{ provisionalBuildingStatus(building.id).label }}
                </small>
              </span>
            </label>
          </div>
          <p v-else class="mt-2 text-11px text-danger">
            {{ scopeBasis === 'contract'
              ? '清单未提供可验证的显式楼栋范围，或合同范围已全部纳入排程。'
              : '当前项目尚未维护可用楼栋，或楼栋已全部纳入排程。' }}
          </p>
          <NuxtLink
            v-if="scopeBasis === 'provisional'"
            :to="{
              path: '/subcontract/quantity/region',
              query: {
                project: projectId || undefined,
                origin: libraryOrigin,
                return: 'schedule',
                resume: 'region',
              },
            }"
            class="btn-primary mt-3 w-fit"
            @click="saveDraftForRegion"
          >
            配置楼栋、楼层与户
          </NuxtLink>
          <p v-if="scopeBasis === 'contract' && outsideBuildingNames" class="mt-2 text-10px text-ink-faint">
            项目库中不属于本合同：{{ outsideBuildingNames }}
          </p>
        </fieldset>
      </div>
    </section>

    <section
      v-else-if="currentStep === 2"
      class="panel min-w-0 overflow-hidden"
      :inert="store.saving || Boolean(store.pendingCommand) || confirming"
      data-schedule-wizard-step="2"
    >
      <header class="border-b border-line px-4 py-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-15px font-850 text-ink">
              调整标准工序
            </h2>
            <p class="mt-1 text-11px text-ink-soft">
              可停用、改工期或指定锚点；日期和 FS 前置会实时重算。
            </p>
          </div>
          <div class="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <SelectFilter
              v-model="processLibraryId"
              aria-label="标准工序库"
              :options="processLibraryOptions"
              :min-width="210"
              placeholder="选择标准工序库"
            />
            <button type="button" class="btn-ghost" @click="toggleAllTasks(true)">
              全选
            </button>
            <button type="button" class="btn-ghost" @click="toggleAllTasks(false)">
              清空
            </button>
          </div>
        </div>
        <div class="process-options mt-4">
          <label>
            <span class="field-label block">计划开始</span>
            <input v-model="startDate" type="date" class="field-input w-full">
          </label>
          <fieldset>
            <legend class="field-label">
              工序搭接
            </legend>
            <div class="mt-1 flex flex-wrap gap-3">
              <label
                v-for="option in [
                  { key: 'half', label: '半程搭接' },
                  { key: 'seq', label: '完全顺排' },
                  { key: 'same', label: '同步开工' },
                ]"
                :key="option.key"
                class="flex items-center gap-2 text-12px text-ink-soft"
              >
                <input v-model="overlapMode" type="radio" :value="option.key" class="accent-[var(--brand)]">
                {{ option.label }}
              </label>
            </div>
          </fieldset>
          <div class="rounded-lg bg-brand-soft px-3 py-2 text-11px text-brand-deep">
            {{ activeProcessLibrary?.name ?? '标准工序' }} · 已启用 {{ enabledCount }} 道 · 预计完成 {{ finishDate }}
          </div>
          <NuxtLink
            :to="{ path: '/schedule/process-library', query: processLibraryNavigationQuery(libraryOrigin ?? 'real', libraryReturnTo) }"
            class="text-11px font-700 text-brand hover:underline"
          >
            维护标准工序库 →
          </NuxtLink>
        </div>
      </header>
      <ScheduleTemplateGanttEditor
        :rows="ganttRows"
        @update-window="updateTaskWindow"
      />
      <div class="process-scroll overflow-x-auto" data-testid="schedule-new-process-scroll">
        <div class="process-table min-w-760px">
          <div class="process-row process-head">
            <span>启用</span><span>工序</span><span>工种</span><span>工期(天)</span><span>锚点开始</span><span>FS 前置</span><span>计划日期</span>
          </div>
          <div v-for="task in tasks" :key="task.templateKey" class="process-row">
            <input v-model="task.enabled" type="checkbox" class="accent-[var(--brand)]" :aria-label="`启用${templateByKey.get(task.templateKey)?.name}`">
            <span class="min-w-0 truncate font-700 text-ink"><i class="mr-2 inline-block h-2 w-2 rounded-full" :style="{ background: templateByKey.get(task.templateKey)?.color }" />{{ templateByKey.get(task.templateKey)?.name }}</span>
            <span>{{ templateByKey.get(task.templateKey)?.trade }}</span>
            <input
              :value="task.durationDays"
              type="number"
              min="1"
              max="365"
              class="field-input w-20"
              :disabled="!task.enabled"
              :aria-label="`${templateByKey.get(task.templateKey)?.name}默认工期`"
              @change="updateTaskDuration(task, $event)"
            >
            <input
              :value="task.anchorStart ?? ''"
              type="date"
              class="field-input w-34"
              :disabled="!task.enabled"
              :aria-label="`${templateByKey.get(task.templateKey)?.name}锚点开始`"
              @change="updateTaskAnchor(task, $event)"
            >
            <span
              class="truncate"
              :class="task.predecessorDisabled && 'text-ink-faint line-through'"
              :title="predecessorLabel(task.templateKey)"
            >
              {{ task.enabled ? predecessorLabel(task.templateKey) : '—' }}
            </span>
            <span>{{ planByKey.get(task.templateKey)?.plannedStart ?? '—' }}<br><small>{{ planByKey.get(task.templateKey)?.plannedFinish ?? '—' }}</small></span>
          </div>
        </div>
      </div>
    </section>

    <section
      v-else
      class="panel mx-auto w-full max-w-6xl overflow-hidden"
      :inert="store.saving || Boolean(store.pendingCommand) || confirming"
      data-schedule-wizard-step="3"
    >
      <header class="border-b border-line px-4 py-4 sm:px-5">
        <h2 class="text-15px font-850 text-ink">
          预览并生成排程
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          最后核对数据依据、楼栋数量、工序顺序和日期；此页不会自动保存。
        </p>
      </header>
      <div class="summary-grid p-4 sm:p-5">
        <div><span>范围依据</span><strong>{{ scopeBasis === 'contract' ? '合同清单' : '内部暂估' }}</strong></div>
        <div><span>楼栋分组</span><strong>{{ name }}</strong></div>
        <div><span>楼栋数量</span><strong>{{ buildingIds.length }} 栋</strong></div>
        <div><span>标准工序</span><strong>{{ enabledCount }} 道</strong></div>
        <div><span>计划开始</span><strong>{{ startDate }}</strong></div>
        <div><span>预计完成</span><strong>{{ finishDate }}</strong></div>
        <div><span>覆盖核对</span><strong :title="coverageReview">{{ coverageReview }}</strong></div>
        <div>
          <span>依赖冲突</span>
          <strong>{{ disabledConflictCount ? `${disabledConflictCount} 条已确认置灰` : '无冲突' }}</strong>
        </div>
        <div>
          <span>阻断项</span>
          <strong :class="confirmationBlockers.length ? 'text-danger' : 'text-ok'">
            {{ confirmationBlockers.length ? `${confirmationBlockers.length} 项待处理` : '0 项，可生成' }}
          </strong>
        </div>
      </div>
      <p
        v-if="confirmationBlockers.length"
        class="mx-4 mb-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-11px text-danger sm:mx-5"
        role="alert"
      >
        {{ confirmationBlockers.join('；') }}
      </p>
      <p
        v-if="scopeBasis === 'provisional'"
        class="mx-4 mb-4 rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-11px text-warning sm:mx-5"
      >
        当前为内部暂估排程，生成后保持“待绑定合同”；后续绑定时先核对楼栋、分项与数量差异。
      </p>
      <div class="preview-scroll overflow-x-auto" data-testid="schedule-new-preview-scroll">
        <table class="min-w-720px">
          <thead>
            <tr>
              <th>#</th>
              <th>工序</th>
              <th>工种</th>
              <th>工期</th>
              <th>FS 前置</th>
              <th>计划开始</th>
              <th>计划完成</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in plannedRows" :key="row.key">
              <td>{{ index + 1 }}</td>
              <td class="font-700 text-ink">
                {{ templateByKey.get(row.key)?.name }}
              </td>
              <td>{{ templateByKey.get(row.key)?.trade }}</td>
              <td class="font-mono">
                {{ row.durationDays }} 天
              </td>
              <td>{{ predecessorLabel(row.key) }}</td>
              <td class="font-mono">
                {{ row.plannedStart }}
              </td>
              <td class="font-mono">
                {{ row.plannedFinish }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer v-if="!loadError" class="wizard-actions panel">
      <button v-if="currentStep > 1" :disabled="store.saving || Boolean(store.pendingCommand) || confirming" type="button" class="btn-ghost" @click="previousStep">
        上一步
      </button>
      <span v-else />
      <button
        v-if="currentStep < 3"
        type="button"
        class="btn-primary"
        :disabled="store.saving || Boolean(store.pendingCommand) || confirming || (currentStep === 1 && (!initialized || loadingRange || provisionalRangeBlockers.length > 0))"
        @click="nextStep"
      >
        {{ currentStep === 1 ? '下一步：选择工序' : '下一步：预览排程' }}
      </button>
      <button
        v-else
        type="button"
        class="btn-accent"
        :disabled="!canWrite || store.saving || confirmationBlockers.length > 0"
        @click="submit"
      >
        <span v-if="store.saving" class="i-lucide-loader-circle mr-1 animate-spin" />
        生成排程
      </button>
    </footer>
  </div>
</template>

<style scoped>
.schedule-new { container-type: inline-size; overflow: hidden; }
.wizard-stepper { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); overflow: hidden; }
.wizard-step { position: relative; display: flex; min-width: 0; align-items: center; gap: 10px; padding: 12px 16px; color: var(--ink-faint); }
.wizard-step:not(:last-child)::after { position: absolute; top: 50%; right: -4px; z-index: 1; width: 8px; height: 8px; border-top: 1px solid var(--line); border-right: 1px solid var(--line); background: var(--panel); content: ''; transform: translateY(-50%) rotate(45deg); }
.wizard-step__index { display: grid; width: 26px; height: 26px; flex: 0 0 auto; place-items: center; border: 1px solid var(--line); border-radius: 999px; font-size: 11px; font-weight: 800; }
.wizard-step b, .wizard-step small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wizard-step b { color: var(--ink-soft); font-size: 12px; }
.wizard-step small { margin-top: 2px; font-size: 10px; }
.wizard-step.is-active { background: var(--brand-soft); }
.wizard-step.is-active .wizard-step__index { border-color: var(--brand); background: var(--brand); color: white; }
.wizard-step.is-active b { color: var(--brand-deep); }
.wizard-step.is-complete .wizard-step__index { border-color: var(--ok); color: var(--ok); }
.range-grid { display: grid; grid-template-columns: minmax(0, .9fr) minmax(18rem, 1.1fr); gap: 24px; }
.building-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px; }
.scope-option { display: flex; min-width: 0; cursor: pointer; align-items: flex-start; gap: 8px; border: 1px solid var(--line); border-radius: 8px; padding: 8px; color: var(--ink-soft); }
.scope-option.is-active { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); }
.scope-option b, .scope-option small { display: block; }
.scope-option small { margin-top: 2px; color: var(--ink-faint); font-size: 10px; line-height: 1.35; }
.process-options { display: grid; grid-template-columns: 180px minmax(260px, 1fr) auto; align-items: end; gap: 16px; }
.process-row { display: grid; grid-template-columns: 42px minmax(210px, 1.4fr) 76px 86px 142px minmax(150px, 1fr) 126px; align-items: center; min-height: 42px; gap: 8px; border-bottom: 1px solid var(--line); padding: 6px 12px; color: var(--ink-soft); font-size: 11px; }
.process-row > :nth-child(n+4) { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.process-head { min-height: 34px; background: var(--surface-2); color: var(--ink-faint); font-size: 10px; font-weight: 700; }
.summary-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.summary-grid div { display: grid; gap: 4px; border-radius: 8px; background: var(--surface-2); padding: 12px; }
.summary-grid span { color: var(--ink-faint); font-size: 10px; }
.summary-grid strong { min-width: 0; color: var(--ink); font-size: 13px; overflow-wrap: anywhere; white-space: normal; }
.preview-scroll table { width: 100%; border-collapse: collapse; font-size: 11px; }
.preview-scroll th, .preview-scroll td { height: 40px; border-bottom: 1px solid var(--line); padding: 0 12px; text-align: left; white-space: nowrap; }
.preview-scroll th { background: var(--surface-2); color: var(--ink-faint); font-size: 10px; }
.wizard-actions { position: sticky; bottom: 12px; z-index: 3; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; box-shadow: 0 8px 28px rgb(15 23 42 / 12%); }
@container (max-width: 48rem) {
  .range-grid { grid-template-columns: minmax(0, 1fr); }
  .process-options { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@container (max-width: 30rem) {
  .wizard-step { justify-content: center; padding: 10px 6px; }
  .wizard-step small { display: none; }
  .wizard-step__index { width: 22px; height: 22px; }
  .building-grid, .summary-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
