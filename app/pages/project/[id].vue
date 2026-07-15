<script setup lang="ts">
import type { StatusTone } from '~/lib/project/status'
import { PROJECT_STATUS_TONE } from '~/lib/project/status'

const route = useRoute()
const store = useProjectStore()

const projectId = computed(() => route.params.id as string)
const project = computed(() => store.byId(projectId.value))

const showEdit = ref(false) // 顶部「编辑」入口（与列表页共用 ProjectFormDialog，共享 store 实时联动）

// 页签标题回填为项目名（如「合和新城」），取代通用「项目详情」
useTabTitle(() => project.value?.name)

// 语义色调 → 详情页 chip class（色调映射见 ~/lib/project/status，与列表页共用同一状态源）
const TONE_CHIP: Record<StatusTone, string> = {
  warn: 'chip-warn',
  brand: 'chip-brand',
  muted: 'chip bg-surface-3 text-ink-faint',
  ok: 'chip-ok',
}
function statusChip(status: string): string {
  const tone = PROJECT_STATUS_TONE[status]
  return tone ? TONE_CHIP[tone] : 'chip-brand'
}

const activeTab = ref('detail')
const tabs = [
  { key: 'detail', label: '详细资料' },
  { key: 'budget', label: '成本预算' },
  { key: 'construction', label: '施工合同管理' },
  { key: 'expenditure', label: '支出合同管理' },
  { key: 'tax', label: '票税管理' },
  { key: 'fund', label: '资金管理' },
  { key: 'current', label: '往来款' },
  { key: 'payment', label: '支付明细' },
  { key: 'material', label: '物资管理' },
  { key: 'acceptance', label: '竣工验收及保修' },
]

// 首次加载完成标记：区分「加载中」与「加载完成但项目不存在/已软删」两态，
// 避免深链直达时在 load 前一闪「不存在」；软删后（列表页删除经共享 store 联动）此页
// project 变 undefined 且 ready=true，落到不存在态而非永远「加载中」。
const ready = shallowRef(false)
onMounted(async () => {
  await store.load()
  ready.value = true
})
</script>

<template>
  <div v-if="project">
    <!-- 顶栏 -->
    <div class="border border-line bg-panel mb-3 px-4 py-3">
      <div class="flex items-center gap-3 mb-2">
        <NuxtLink to="/project" class="icon-btn" title="返回列表">
          <span class="i-lucide-arrow-left text-14px" />
        </NuxtLink>
        <span
          class="grid h-11 w-11 flex-none place-items-center rounded-[10px] bg-brand-soft text-20px text-brand font-800"
          aria-hidden="true"
        >
          {{ project.name.slice(0, 1) }}
        </span>
        <div class="min-w-0">
          <div class="flex items-center gap-2.5">
            <h2 class="truncate text-17px text-ink font-800">
              {{ project.name }}
            </h2>
            <span class="chip flex-none" :class="[statusChip(project.status)]">
              {{ project.status }}
            </span>
          </div>
          <div class="mt-0.5 truncate text-12px text-ink-soft">
            {{ project.contractName || '—' }} · {{ project.region || '—' }}
          </div>
        </div>
        <div class="flex-1" />
        <button class="btn-secondary" @click="showEdit = true">
          <span class="i-lucide-square-pen text-13px mr-1" /> 编辑
        </button>
      </div>
      <!-- 元数据摘要行 -->
      <div class="info-row text-12px">
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            业务流程阶段
          </div>
          <div>{{ project.status }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            经营类型
          </div>
          <div>{{ project.operationType || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            项目经理
          </div>
          <div>{{ project.manager || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            客户(甲方)
          </div>
          <div>{{ project.developer || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">
            承包单位
          </div>
          <div>{{ project.contractor || '—' }}</div>
        </div>
      </div>
    </div>

    <ProjectMetrics :project-id="projectId" />

    <!-- 阶段时间线 -->
    <ProjectTimeline />

    <!-- Tab 栏 -->
    <div class="flex border-b border-line mb-4 overflow-x-auto">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="content-tab whitespace-nowrap"
        :class="activeTab === t.key ? 'content-tab-active' : ''"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- Tab 内容 -->
    <div v-if="activeTab === 'detail'">
      <ProjectDetailTab :project="project" />
    </div>
    <div v-else>
      <ProjectSubTables :tab="activeTab" :project-id="projectId" />
    </div>

    <!-- 顶部「编辑」入口：与列表页共用同一表单组件，保存经共享 store 双页实时联动（#61） -->
    <ProjectFormDialog v-model:open="showEdit" :project="project" />
  </div>

  <div v-else-if="!ready || store.loading" class="py-12 text-center text-ink-faint">
    加载中...
  </div>

  <!-- 加载完成但项目不存在或已被软删除：给出明确空态与返回入口，而非永远「加载中」 -->
  <div v-else class="flex flex-col items-center gap-3 py-16 text-center">
    <span class="i-lucide-file-x h-8 w-8 text-ink-faint" aria-hidden="true" />
    <p class="text-14px text-ink font-700">
      项目不存在或已被删除
    </p>
    <p class="text-12px text-ink-faint">
      该项目可能已在别处被删除，可返回列表查看。
    </p>
    <NuxtLink to="/project" class="btn-secondary mt-1">
      <span class="i-lucide-arrow-left text-13px mr-1" /> 返回项目列表
    </NuxtLink>
  </div>
</template>
