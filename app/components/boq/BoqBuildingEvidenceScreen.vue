<script setup lang="ts">
import ScheduleCommandRecovery from '~/components/schedule/ScheduleCommandRecovery.vue'
import SelectFilter from '~/components/ui/SelectFilter.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { useBoqBuildingEvidence } from '~/composables/useBoqBuildingEvidence'
import { formatQuantityValue } from '~/lib/quantity/format'

const { read, selectedLine, lineId, buildingId, reason, loading, error, canEdit, readonlyMode, floorLinks, busy, store, lineOptions, buildingOptions, selectLine, save, leave, recover, recheck } = useBoqBuildingEvidence()
</script>

<template>
  <div class="grid min-w-0 gap-4">
    <header class="panel flex min-w-0 items-start gap-3 p-4">
      <button type="button" class="icon-btn flex-none" aria-label="返回合同绑定" :disabled="store.saving || !!store.pendingCommand" @click="leave">
        <span class="i-lucide-arrow-left" />
      </button>
      <div class="min-w-0">
        <p class="text-11px font-700 text-brand">
          合同清单 · 来源更正
        </p><h1 class="mt-1 text-20px font-850">
          {{ readonlyMode ? '合同清单来源' : '更正楼栋证据' }}
        </h1><p class="mt-2 text-12px leading-6 text-ink-soft">
          {{ readonlyMode ? '只读核对合同来源与绑定时保存的楼层关系，原计划和数量快照保持不变。' : '核对已确认导入的原清单行，仅更正明确的楼栋归属。保存或取消后回到原分组重新预览。' }}
        </p>
      </div>
    </header>
    <CommandRecoveryPanel v-if="read?.contractVersion && store.pendingCommand" :command-id="store.pendingCommand.commandId" :saved="store.knownSaved" :busy="busy" @recover="recover" />
    <ScheduleCommandRecovery v-else-if="store.pendingCommand" :busy="busy" @recover="recover" @recheck="recheck" />
    <StatePanel v-if="loading && !read" kind="loading" title="正在核对合同清单来源" compact />
    <div v-if="error" class="panel grid gap-2 border-danger/30 bg-danger-soft p-3 text-12px text-danger-ink" role="alert">
      <p>{{ error }}</p><button type="button" class="btn-secondary justify-self-start" :disabled="busy" @click="recheck">
        重新核对资料
      </button>
    </div>
    <form v-if="read" class="panel grid min-w-0 gap-4 p-4" @submit.prevent="save">
      <div>
        <h2 class="break-words text-15px font-800">
          {{ read.contractName }}
        </h2><p class="mt-1 text-12px text-ink-soft">
          只有已确认导入基准行可更正。签证新增行和来源待核行只读。
        </p>
      </div>
      <div class="min-w-0 max-w-3xl">
        <label class="field-label mb-1 block">合同清单行</label><SelectFilter :model-value="lineId" aria-label="合同清单行" :options="lineOptions" full-width :min-width="0" :disabled="busy || !!store.pendingCommand" placeholder="选择需要核对的清单行" @update:model-value="selectLine" />
      </div>
      <template v-if="selectedLine">
        <section class="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3 rounded bg-surface-2 p-3 text-12px" aria-label="清单原始依据">
          <div><span class="block text-ink-faint">当前楼栋证据</span><strong class="mt-1 block break-words">{{ selectedLine.building || '未提供' }}</strong></div>
          <div><span class="block text-ink-faint">合同量 / 单位</span><strong class="mt-1 block">{{ formatQuantityValue(selectedLine.qty) }} / {{ selectedLine.unit || '未提供' }}</strong></div>
          <div><span class="block text-ink-faint">原单价</span><strong class="mt-1 block">{{ formatQuantityValue(selectedLine.unitPrice) }}</strong></div>
          <div><span class="block text-ink-faint">生效量 / 生效单价</span><strong class="mt-1 block">{{ formatQuantityValue(selectedLine.effectiveQty) }} / {{ formatQuantityValue(selectedLine.effectiveUnitPrice) }}</strong></div>
        </section>
        <p v-if="selectedLine.readOnlyReason || selectedLine.sourceKind !== 'confirmed-import'" class="rounded border border-warn/30 bg-warn-soft p-3 text-12px leading-6 text-warn-ink" role="status">
          {{ selectedLine.readOnlyReason || '此行没有可更正的已确认导入基准，仅可读取。' }}
        </p>
        <div v-if="!readonlyMode" class="grid min-w-0 max-w-3xl gap-4">
          <div><label class="field-label mb-1 block">实际覆盖楼栋</label><SelectFilter v-model="buildingId" aria-label="实际覆盖楼栋" :options="buildingOptions" full-width :min-width="0" :disabled="!canEdit" placeholder="选择同项目的实际楼栋" /></div>
          <label class="grid gap-1 text-12px font-700">更正理由<textarea v-model="reason" class="input min-h-24 w-full resize-y p-3 text-13px font-400" :disabled="!canEdit" maxlength="1000" placeholder="填写所核对的原件位置及更正原因" /></label>
        </div>
      </template>
      <section v-if="readonlyMode && selectedLine" class="grid gap-2 border-t border-line pt-3" aria-label="绑定时的原楼层计划">
        <h3 class="text-13px font-800">
          绑定时的原楼层计划
        </h3>
        <NuxtLink v-for="link in floorLinks" :key="link.id" :to="link.to" class="justify-self-start text-12px text-brand underline">
          {{ link.label }}
        </NuxtLink>
        <p v-if="!floorLinks.length" class="text-12px text-warn-ink">
          该清单行没有可读取的绑定楼层关系；旧缺失明细不会由当前模板补造。
        </p>
      </section>
      <details class="min-w-0 text-11px text-ink-faint">
        <summary class="cursor-pointer">
          查看来源版本与更正记录
        </summary><p class="mt-2 break-all">
          {{ read.sourceVersion }}
        </p><ul class="mt-2 space-y-2">
          <li v-for="entry in read.audit" :key="entry.id" class="break-words">
            {{ entry.occurredAt }} · {{ entry.beforeBuilding || '未提供' }} → {{ entry.building }} · {{ entry.reason }}
          </li>
        </ul>
      </details>
      <footer class="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        <button type="button" class="btn-secondary" :disabled="store.saving || !!store.pendingCommand" @click="leave">
          {{ readonlyMode ? '返回绑定依据' : '取消并返回绑定' }}
        </button><button v-if="!readonlyMode" type="submit" class="btn-primary" :disabled="!canEdit || !buildingId || !reason.trim() || !!error">
          保存楼栋证据
        </button>
      </footer>
    </form>
  </div>
</template>
