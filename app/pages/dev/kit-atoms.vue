<script setup lang="ts">
// 隐藏 dev 演示路由（不在侧边栏 NAV_GROUPS 中）：逐一验证 KitAtoms 七原子。
// 访问 /dev/kit-atoms —— 与 /dev/kit-ui（交互原语）并列的第三块底座验证载体。
import type { TreeNode } from '~/lib/kit/tree-nav'

// ① SelectFilter
const STAGE_OPTS = [
  { key: 'all', label: '全部阶段' },
  { key: 'progress', label: '施工中' },
  { key: 'settle', label: '结算中' },
  { key: 'done', label: '已完工' },
]
const stage = ref('all')

const STATUS_OPTS = [
  { key: 'all', label: '全部状态' },
  { key: 'normal', label: '合作中' },
  { key: 'paused', label: '已暂停' },
]
const status = ref('normal')

// ② SegTab
const LEDGER_TABS = [
  { key: 'all', label: '全部', count: 34 },
  { key: 'pending', label: '待校对', count: 5 },
  { key: 'archived', label: '已归档', count: 29 },
  { key: 'void', label: '已废弃', count: 0 },
]
const ledgerTab = ref('all')

// ③ SearchInput（即输即筛 demo）
const SUPPLIERS = ['华东建材', '广州瑞航建材', '锦泰劳务', '恒基水电', '南方钢构', '德胜五金']
const keyword = ref('')
const filteredSuppliers = computed(() => {
  const q = keyword.value.trim()
  return q ? SUPPLIERS.filter(s => s.includes(q)) : SUPPLIERS
})

// ⑥ TreeNav（发票台账左树；'all' 不给 count，按子节点聚合 = 32）
const ledgerTree: TreeNode[] = [
  {
    key: 'all',
    label: '全部发票',
    icon: 'i-lucide-layers',
    children: [
      { key: 'p1', label: '合和新城', count: 12 },
      { key: 'p2', label: '锦绣江南', count: 8 },
      { key: 'p3', label: '翡翠湾', count: 3 },
      { key: 'unassigned', label: '未归项目', tone: 'warn', icon: 'i-lucide-triangle-alert', count: 3 },
      { key: 'personal', label: '个人开支', tone: 'brand', icon: 'i-lucide-user', count: 6 },
    ],
  },
]
const activeNode = ref('p1')
</script>

<template>
  <div class="mx-auto max-w-4xl py-4">
    <header class="mb-5">
      <div class="flex items-center gap-2">
        <span class="i-lucide-blocks text-16px text-brand" />
        <h1 class="text-16px font-800 text-ink">KitAtoms 原子库演示</h1>
        <span class="chip text-9px bg-warn-soft text-warn-ink">DEV ONLY</span>
      </div>
      <p class="text-12px text-ink-soft mt-1">
        隐藏路由 <code class="text-11px bg-surface-3 px-1 py-0.5">/dev/kit-atoms</code>，
        七个全局展示原子（对照设计稿 KitAtoms，STYLE-GUIDE 疏朗风格）。
      </p>
    </header>

    <div class="space-y-3">
      <!-- ① SelectFilter -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">① SelectFilter — 紧凑下拉筛选</h2>
        <p class="text-12px text-ink-soft mb-3">label + 原生 select + 自绘 chevron；即选即筛。</p>
        <div class="flex flex-wrap items-center gap-4">
          <SelectFilter v-model="stage" label="阶段" :options="STAGE_OPTS" :min-width="150" />
          <SelectFilter v-model="status" label="状态" :options="STATUS_OPTS" />
        </div>
        <p class="text-11px text-ink-faint font-mono mt-3">stage = {{ stage }} · status = {{ status }}</p>
      </section>

      <!-- ② SegTab -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">② SegTab — 下划线分段切换（带数量角标）</h2>
        <p class="text-12px text-ink-soft mb-3">选中态：品牌下划线 + 加粗 + 角标高亮；count 走等宽字体。</p>
        <SegTab v-model="ledgerTab" :tabs="LEDGER_TABS" />
        <p class="text-11px text-ink-faint font-mono mt-3">activeTab = {{ ledgerTab }}</p>
      </section>

      <!-- ③ SearchInput -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">③ SearchInput — pill 搜索框（即输即筛）</h2>
        <p class="text-12px text-ink-soft mb-3">左置放大镜，圆角胶囊；下方列表随输入实时收窄。</p>
        <SearchInput v-model="keyword" placeholder="搜索分供方名…" :width="240" />
        <div class="flex flex-wrap gap-1.5 mt-3">
          <span v-for="s in filteredSuppliers" :key="s" class="chip bg-surface-3 text-ink-soft">{{ s }}</span>
          <span v-if="!filteredSuppliers.length" class="text-12px text-ink-faint">无匹配结果</span>
        </div>
      </section>

      <!-- ④ SectionHeader -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">④ SectionHeader — 品牌竖条区块标题</h2>
        <p class="text-12px text-ink-soft mb-3">4×16 品牌竖条 + 标题；右侧 extra 插槽放操作/说明。</p>
        <SectionHeader>项目经营数据</SectionHeader>
        <SectionHeader :mb="0">
          票据信息
          <template #extra>
            <span class="text-11px text-ink-faint">进项与发票台账实时联动（12 张归档票）</span>
          </template>
        </SectionHeader>
      </section>

      <!-- ⑤ Metric + MetricGrid -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">⑤ Metric / MetricGrid — 指标格网格（金额 ¥#,##0.00 完整展示）</h2>
        <p class="text-12px text-ink-soft mb-3">
          语义固定列数、1px 分隔线；money 开关将数字按 <b>¥#,##0.00</b> 千分位两位小数完整展示（去省略号）；tone 语义色 + ⓘ 公式 + big 大号。
        </p>
        <SectionHeader :mb="8">经营数据（5 列）</SectionHeader>
        <MetricGrid :cols="5">
          <Metric label="主合同金额" :value="8600000" money formula="Σ 施工合同.含税合同金额" />
          <Metric label="增补合同额" :value="1234567.89" money formula="Σ 补充协议.金额" />
          <Metric label="变更后合同额" :value="10450000" money tone="brand" formula="主合同 + 增补 + 变洽签" />
          <Metric label="项目收款" :value="7200000" money tone="ok" formula="Σ 收款登记.收款金额" />
          <Metric label="项目可用资金余额" :value="-158900.5" money tone="danger" big formula="收款 + 往来收款 − 付款 − 管理费" />
        </MetricGrid>

        <SectionHeader :mb="8" class="mt-4">票据信息（6 列，含百分比）</SectionHeader>
        <MetricGrid :cols="6">
          <Metric label="销项票额" :value="7200000" money />
          <Metric label="销项税额" :value="633628.32" money />
          <Metric label="进项票额" :value="4580000" money tone="brand" formula="Σ 发票台账(该项目归档票).价税合计 · 实时联动" />
          <Metric label="进项税额" :value="403185.84" money tone="brand" />
          <Metric label="增值税" :value="230442.48" money tone="brand" />
          <Metric label="税负率" value="3.20%" tone="brand" formula="增值税 / 销项票额" />
        </MetricGrid>
      </section>

      <!-- ⑥ TreeNav -->
      <section class="content-panel p-4">
        <h2 class="text-13px font-700 text-ink mb-1">⑥ TreeNav — 左树导航（数量角标 + 选中态）</h2>
        <p class="text-12px text-ink-soft mb-3">
          节点带数量角标；父节点「全部发票」未显式给数，<b>按子节点聚合 = 32</b>；未归项目 warn 色、个人开支 brand 色；选中态高亮。
        </p>
        <div class="flex gap-4">
          <div class="w-60 flex-none">
            <TreeNav v-model="activeNode" title="发票台账" :items="ledgerTree" />
          </div>
          <div class="flex-1 content-panel bg-surface-2 p-4 rounded-[var(--radius-card)]">
            <p class="text-12px text-ink-soft">当前选中节点</p>
            <p class="text-15px font-800 text-brand-deep font-mono mt-1">{{ activeNode }}</p>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
