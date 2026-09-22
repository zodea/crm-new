<script setup lang="ts">
import type { DataOriginDTO } from '~/types/read-model'
import StatePanel from '~/components/ui/StatePanel.vue'
import { useScheduleContractBinding } from '~/composables/useScheduleContractBinding'
import ScheduleBindingReview from './ScheduleBindingReview.vue'
import ScheduleCommandRecovery from './ScheduleCommandRecovery.vue'

const props = defineProps<{ projectId: string, groupId: string, origin: DataOriginDTO | null }>()
const { read, preview, selectedContractId, loading, error, busy, canChoose, store, fetchContracts, selectContract, bind, cancel, recover, repair, recheck } = useScheduleContractBinding(props)
</script>

<template>
  <div class="binding-screen grid min-w-0 gap-4">
    <header class="binding-header panel flex min-w-0 flex-wrap items-start gap-3 p-4">
      <button type="button" class="icon-btn flex-none" aria-label="返回施工进度" :disabled="store.saving || !!store.pendingCommand" @click="cancel">
        <span class="i-lucide-arrow-left" />
      </button>
      <div class="min-w-0 flex-1">
        <p class="text-11px font-700 text-brand">
          施工进度 · 合同后补
        </p>
        <h1 class="mt-1 text-20px font-850 text-ink">
          {{ read?.state === 'bound' ? '施工合同绑定依据' : '绑定施工合同' }}
        </h1>
        <p class="mt-1 text-12px leading-6 text-ink-soft">
          核对楼栋覆盖和冻结暂估来源，原工序、人工计划、基线与完成事实继续保留。
        </p>
      </div>
      <div v-if="read" class="binding-group min-w-0 max-w-full rounded bg-surface-2 px-3 py-2 text-12px">
        <strong class="block break-words">{{ read.group.name }}</strong>
        <span :class="read.state === 'bound' ? 'text-ok-ink' : 'text-warn-ink'">{{ read.state === 'bound' ? '已绑定合同' : '内部暂估 · 待绑定合同' }}</span>
      </div>
    </header>
    <ScheduleCommandRecovery v-if="store.pendingCommand" :busy="busy" @recover="recover" @recheck="recheck" />
    <StatePanel v-if="loading && !read" kind="loading" title="正在读取合同绑定资料" compact />
    <StatePanel v-else-if="!read && error" kind="error" title="合同绑定资料读取失败" :description="error" action-label="重新读取" @action="recheck" />
    <template v-if="read">
      <section v-if="read.state === 'bound'" class="panel grid min-w-0 gap-2 p-4" aria-label="已绑定合同依据">
        <h2 class="text-15px font-800">
          {{ read.binding?.contractName || '既有施工合同' }} <span class="text-12px font-500 text-ink-soft">{{ read.binding?.contractNo }}</span>
        </h2>
        <p class="text-12px text-ink-soft">
          绑定时间：{{ read.binding?.boundAt || '旧来源未记录' }}。此处只读，不提供重复绑定、解绑或换绑。
        </p>
        <p class="break-words text-12px text-ink-soft">
          绑定经办身份：{{ read.binding?.actorId || '旧来源未记录' }}
        </p>
        <p v-if="read.binding?.legacyDetailMissing" class="text-12px leading-6 text-warn-ink">
          旧来源没有保存绑定时的完整差异，当前只展示真实关系与已有历史，不以当前清单或模板补造。
        </p>
      </section>
      <section v-else class="panel grid min-w-0 gap-3 p-4" aria-label="选择施工合同">
        <div>
          <h2 class="text-14px font-800">
            选择同项目施工合同
          </h2><p class="mt-1 text-12px text-ink-soft">
            选择后先预览，不会直接绑定。
          </p>
        </div>
        <div class="min-w-0 max-w-2xl">
          <label class="field-label block">施工合同</label>
          <p v-if="!canChoose || error" aria-label="已选施工合同" class="min-h-8 break-words rounded border border-line bg-surface-2 px-3 py-2 text-13px">
            {{ read.contracts.find(contract => contract.id === selectedContractId)?.name || '尚未选择施工合同' }}
          </p>
          <LookupSelect v-else :model-value="selectedContractId || null" :fetch="fetchContracts" field="scheduleContractId" placeholder="搜索合同名称或编号" @update:model-value="selectContract" />
        </div>
        <p v-if="!read.capabilities.includes('schedule:write') || read.origin !== 'real'" class="text-12px text-warn-ink">
          当前身份只能读取绑定资料。
        </p>
      </section>
      <div v-if="error" class="panel grid gap-2 border-danger/30 bg-danger-soft p-3 text-12px text-danger-ink" role="alert">
        <p>{{ error }}</p><p>合同选择已保留，请重新核对最新资料后再确认。</p>
        <button type="button" class="btn-secondary justify-self-start" :disabled="busy" @click="recheck">
          重新核对资料
        </button>
      </div>
      <StatePanel v-if="loading" kind="loading" title="正在核对合同差异" compact />
      <ScheduleBindingReview v-else-if="preview || read.binding?.preview" :preview="(preview || read.binding?.preview)!" :source-version="read.binding?.sourceVersion || read.sourceVersion" :readonly="read.state === 'bound' || !canChoose || !!error" :busy="busy" :bound="read.state === 'bound'" @bind="bind" @repair="repair" />
      <StatePanel v-else-if="read.state === 'unbound' && !error" kind="empty" title="请选择一份施工合同" description="随后展示楼栋覆盖、稳定分项映射与按单位核对的数量差异。" compact />
    </template>
  </div>
</template>

<style scoped>
.binding-screen { container-type: inline-size; }
@container (max-width: 40rem) {
  .binding-group { flex-basis: 100%; }
}
</style>
