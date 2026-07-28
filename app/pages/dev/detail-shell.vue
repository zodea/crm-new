<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'

type DemoState = 'ready' | 'loading' | 'empty' | 'error' | 'forbidden' | 'not-found'

const state = shallowRef<DemoState>('ready')
const activeTab = shallowRef('contracts')

const states: { key: DemoState, label: string }[] = [
  { key: 'ready', label: '默认' },
  { key: 'loading', label: '加载' },
  { key: 'empty', label: '空数据' },
  { key: 'error', label: '错误' },
  { key: 'forbidden', label: '无权限' },
  { key: 'not-found', label: '不存在' },
]
const tabs = [
  { key: 'contracts', label: '合同与结算事实', count: 2 },
  { key: 'invoices', label: '跨项目收票与税额明细', count: 1 },
  { key: 'payments', label: '请款、审批与实际付款记录', count: 2 },
]
const columns: KitTableColumn[] = [
  { field: 'no', title: '业务编号', width: 150 },
  { field: 'project', title: '所属项目', minWidth: 180 },
  { field: 'contract', title: '合同名称', minWidth: 260 },
  { field: 'amount', title: '含税金额', type: 'money', width: 150 },
  { field: 'settled', title: '累计结算', type: 'money', width: 150 },
  { field: 'paid', title: '实际付款', type: 'money', width: 150 },
  { field: 'status', title: '当前状态', width: 110 },
]
const rows = [
  {
    id: 'demo-1',
    no: 'HT-DEMO-001',
    project: '示范项目一',
    contract: '机电材料采购及配套服务合同',
    amount: 261250,
    settled: 201250,
    paid: 101138,
    status: '履约中',
  },
  {
    id: 'demo-2',
    no: 'HT-DEMO-002',
    project: '示范项目二',
    contract: '零星辅材框架采购合同',
    amount: 98000,
    settled: 68000,
    paid: 50000,
    status: '结算中',
  },
]

const stateTitle = computed(() => ({
  'ready': '',
  'loading': '正在加载分供方详情演示',
  'empty': '该分供方还没有业务数据',
  'error': '分供方详情加载失败',
  'forbidden': '无权查看该分供方',
  'not-found': '分供方不存在或已删除',
})[state.value])
const stateDescription = computed(() => ({
  'ready': '',
  'loading': '',
  'empty': '建立合作项目或合同后，业务事实会显示在这里。',
  'error': '演示数据库暂时不可用，请重新加载。',
  'forbidden': '请联系管理员申请分供方业务范围。',
  'not-found': '该记录可能已被删除，可返回列表查看。',
})[state.value])
</script>

<template>
  <div class="flex min-w-0 flex-col gap-4">
    <section class="panel flex flex-wrap items-center gap-2 p-3" role="group" aria-label="详情壳状态预览">
      <strong class="mr-2 text-12px text-ink">DEV · 详情壳状态</strong>
      <button
        v-for="item in states"
        :key="item.key"
        type="button"
        class="btn-secondary"
        :class="state === item.key ? 'border-brand text-brand-deep' : ''"
        :aria-pressed="state === item.key"
        @click="state = item.key"
      >
        {{ item.label }}
      </button>
    </section>

    <EntityDetailShell
      title="华南区域机电设备与建筑辅材长期战略合作分供方有限公司"
      subtitle="SUP-DEMO-2026-0001 · 专业材料供应 · 评价 A"
      back-to="/dev/kit-ui"
      back-label="返回 KitUI 演示"
      aside-label="文件与动态"
      :state="state"
      :state-title="stateTitle"
      :state-description="stateDescription"
      :state-action-label="state === 'error' ? '重新加载' : ''"
      @state-action="state = 'ready'"
    >
      <template #mark>
        <div class="grid h-11 w-11 place-items-center rounded-[var(--radius-card)] bg-brand-soft text-18px font-800 text-brand">
          供
        </div>
      </template>

      <template #status>
        <span class="chip chip-ok">资料合格</span>
      </template>

      <template #actions>
        <button type="button" class="btn-secondary">
          合规提醒
        </button>
        <button type="button" class="btn-primary">
          编辑
        </button>
      </template>

      <template #summary>
        <MetricGrid :cols="6">
          <Metric label="合作项目" value="2 个" />
          <Metric label="合同总额" :value="359250" money />
          <Metric label="累计请款" :value="220000" money />
          <Metric label="累计收票" :value="123800" money />
          <Metric label="累计已付" :value="151138" money tone="ok" />
          <Metric label="应付余额" :value="208112" money tone="danger" big formula="合同额 − 累计已付" />
        </MetricGrid>
      </template>

      <section class="panel mb-4 p-4" aria-labelledby="detail-shell-process-title">
        <SectionHeader>
          <span id="detail-shell-process-title">流程事实</span>
        </SectionHeader>
        <ol class="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <li class="rounded-[var(--radius-sm)] bg-surface-2 p-3 text-12px">
            <strong class="block text-ink">资料建档</strong>
            <span class="text-ink-soft">已完成 · 2026-02-18</span>
          </li>
          <li class="rounded-[var(--radius-sm)] bg-surface-2 p-3 text-12px">
            <strong class="block text-ink">合作履约</strong>
            <span class="text-brand-deep">进行中 · 2 个项目</span>
          </li>
          <li class="rounded-[var(--radius-sm)] bg-surface-2 p-3 text-12px">
            <strong class="block text-ink">结算归档</strong>
            <span class="text-ink-soft">等待业务完成</span>
          </li>
        </ol>
      </section>

      <nav class="mb-4 overflow-x-auto" aria-label="详情壳业务页签">
        <SegTab v-model="activeTab" :tabs="tabs" />
      </nav>

      <div
        v-if="activeTab === 'contracts'"
        data-testid="detail-shell-table-scroll"
        class="min-w-0 overflow-x-auto"
      >
        <div class="min-w-265">
          <KitTable
            :columns="columns"
            :data="rows"
            :min-rows="5"
          />
        </div>
      </div>
      <StatePanel
        v-else
        kind="empty"
        :title="activeTab === 'invoices' ? '暂无更多发票' : '暂无更多付款记录'"
        description="切换到合同与结算事实可查看密集子表演示。"
        compact
      />

      <template #aside>
        <div class="flex flex-col gap-4">
          <section class="panel p-4">
            <SectionHeader :mb="8">
              文件管理
            </SectionHeader>
            <ul class="space-y-2 text-11px">
              <li class="flex min-w-0 items-center gap-2">
                <span class="i-lucide-file-text shrink-0 text-brand" aria-hidden="true" />
                <span class="min-w-0 truncate">营业执照（演示）.pdf</span>
              </li>
              <li class="flex min-w-0 items-center gap-2">
                <span class="i-lucide-file-text shrink-0 text-brand" aria-hidden="true" />
                <span class="min-w-0 truncate">开户许可证（演示）.pdf</span>
              </li>
            </ul>
          </section>
          <section class="panel p-4">
            <SectionHeader :mb="8">
              动态
            </SectionHeader>
            <p class="text-11px leading-5 text-ink-soft">
              详情壳只承载辅助栏位置，评论、审批和业务动作仍由领域模块提供。
            </p>
          </section>
        </div>
      </template>
    </EntityDetailShell>
  </div>
</template>
