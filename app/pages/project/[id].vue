<script setup lang="ts">
const route = useRoute()
const store = useProjectStore()

const projectId = computed(() => route.params.id as string)
const project = computed(() => store.byId(projectId.value))

const STATUS_COLOR: Record<string, string> = {
  '筹备中': 'chip-warn',
  '施工中': 'chip-brand',
  '停工': 'chip bg-surface-3 text-ink-faint',
  '已竣工': 'chip-ok',
  '已结算': 'chip-ok',
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

// 经营数据面板（V1 用 0 占位，后续从子表实时聚合）
const operationData = computed(() => {
  const p = project.value
  if (!p) return []
  return [
    { label: '主合同金额(元)', value: 0, color: '' },
    { label: '增补合同额(元)', value: 0, color: '' },
    { label: '变洽签审定额(元)', value: 0, color: '' },
    { label: '变更后合同额', value: 0, color: '' },
    { label: '项目收款(元)', value: 0, color: 'text-ok' },
    { label: '付款金额(元)', value: 0, color: 'text-danger' },
    { label: '往来收款(元)', value: 0, color: 'text-ok' },
    { label: '往来付款', value: 0, color: 'text-danger' },
    { label: '扣除管理费(元)', value: 0, color: '' },
    { label: '扣除管理费(元)', value: 0, color: '' },
    { label: '项目可用资金余额', value: 0, color: 'text-brand font-700', span: true },
  ]
})

const invoiceData = computed(() => [
  { label: '销项票额(元)', value: 0 },
  { label: '销项税额(元)', value: 0 },
  { label: '进项票额(元)', value: 0 },
  { label: '进项税额(元)', value: 0 },
  { label: '增值税', value: 0 },
  { label: '税负率', value: '0.00%', isFmt: true },
])

function fmtMoney(v: number): string {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

onMounted(() => store.load())
</script>

<template>
  <div v-if="project">
    <!-- 顶栏 -->
    <div class="border border-line bg-panel mb-3 px-4 py-3">
      <div class="flex items-center gap-3 mb-2">
        <NuxtLink to="/project" class="icon-btn" title="返回列表">
          <span class="i-lucide-arrow-left text-14px" />
        </NuxtLink>
        <h2 class="text-17px font-800 text-ink">{{ project.name }}</h2>
        <span class="text-13px text-ink-faint">项目信息</span>
        <span :class="['chip', STATUS_COLOR[project.status] || 'chip-brand']">
          {{ project.status }}
        </span>
        <div class="flex-1" />
        <button class="btn-secondary">
          <span class="i-lucide-square-pen text-13px mr-1" /> 编辑
        </button>
      </div>
      <!-- 元数据摘要行 -->
      <div class="info-row text-12px">
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">业务流程阶段</div>
          <div>{{ project.status }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">经营类型</div>
          <div>{{ project.operationType || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">项目经理</div>
          <div>{{ project.manager || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">客户(甲方)</div>
          <div>{{ project.developer || '—' }}</div>
        </div>
        <div class="info-cell">
          <div class="text-9px text-ink-faint mb-0.5">承包单位</div>
          <div>{{ project.contractor || '—' }}</div>
        </div>
      </div>
    </div>

    <!-- 项目经营数据 -->
    <div class="border border-line bg-panel mb-3 px-4 py-3">
      <h4 class="text-11px font-600 text-ink-faint mb-2 tracking-wide">项目经营数据（自动计算）</h4>
      <div class="grid grid-cols-6 gap-px bg-line">
        <div
          v-for="(d, i) in operationData"
          :key="i"
          class="bg-panel px-3 py-2"
          :class="d.span ? 'col-span-2' : ''"
        >
          <div class="text-9px text-ink-faint mb-1 flex items-center gap-1">
            {{ d.label }}
            <span class="i-lucide-info text-10px cursor-help" title="从子表实时聚合" />
          </div>
          <div class="font-mono text-16px tabular-nums" :class="d.color">
            {{ typeof d.value === 'number' ? fmtMoney(d.value) : d.value }}
          </div>
        </div>
      </div>
    </div>

    <!-- 票据信息 -->
    <div class="border border-line bg-panel mb-3 px-4 py-3">
      <h4 class="text-11px font-600 text-ink-faint mb-2 tracking-wide">票据信息（自动计算）</h4>
      <div class="grid grid-cols-6 gap-px bg-line">
        <div
          v-for="(d, i) in invoiceData"
          :key="i"
          class="bg-panel px-3 py-2"
        >
          <div class="text-9px text-ink-faint mb-1">{{ d.label }}</div>
          <div class="font-mono text-16px tabular-nums">
            {{ d.isFmt ? d.value : fmtMoney(d.value as number) }}
          </div>
        </div>
      </div>
    </div>

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
    <div v-else class="border border-line bg-panel p-8 text-center text-ink-faint text-13px">
      {{ tabs.find(t => t.key === activeTab)?.label }} — 待实现（子表数据需要对应模块先完成）
    </div>
  </div>

  <div v-else class="py-12 text-center text-ink-faint">
    加载中...
  </div>
</template>
