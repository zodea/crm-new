<script setup lang="ts">
const projStore = useProjectStore()

const selectedProjectId = shallowRef<string | ''>('')

const projects = computed(() => projStore.list)

const metrics = computed(() => [
  {
    label: '合同总额',
    value: 0,
    icon: 'i-lucide-file-signature',
    color: 'brand' as const,
    suffix: '元',
    money: true,
  },
  {
    label: '累计收款',
    value: 0,
    icon: 'i-lucide-banknote',
    color: 'ok' as const,
    suffix: '元',
    money: true,
  },
  {
    label: '累计支出',
    value: 0,
    icon: 'i-lucide-receipt',
    color: 'danger' as const,
    suffix: '元',
    money: true,
  },
  {
    label: '已开票额',
    value: 0,
    icon: 'i-lucide-file-text',
    color: 'brand' as const,
    suffix: '元',
    money: true,
  },
  {
    label: '材料分供方数',
    value: 0,
    icon: 'i-lucide-building-2',
    color: 'brand' as const,
    suffix: '家',
    money: false,
  },
])

onMounted(async () => {
  await projStore.load()
  const first = projects.value[0]
  if (first && !selectedProjectId.value) {
    selectedProjectId.value = first.id
  }
})
</script>

<template>
  <div>
    <!-- 项目选择器 -->
    <div class="flex flex-wrap items-center gap-3 mb-4">
      <h2 class="text-17px font-800 text-ink">
        在建工程总览
      </h2>
      <select
        v-model="selectedProjectId"
        class="field-input w-64 max-w-full"
      >
        <option value="">
          全部项目
        </option>
        <option v-for="p in projects" :key="p.id" :value="p.id">
          {{ p.name }}
        </option>
      </select>
    </div>

    <!-- 指标卡片 -->
    <div class="dashboard-metrics grid gap-3 mb-6">
      <StatCard
        v-for="m in metrics"
        :key="m.label"
        :label="m.label"
        :value="m.value"
        :icon="m.icon"
        :color="m.color"
        :suffix="m.suffix"
        :money="m.money"
      />
    </div>

    <!-- 图表区 -->
    <div class="dashboard-charts grid gap-3">
      <!-- 月度支出柱状图 55% -->
      <div class="border border-line bg-panel p-4" style="grid-column: span 1">
        <h4 class="text-13px font-700 text-ink mb-3 flex items-center gap-1.5">
          <span class="i-lucide-chart-bar text-14px text-ink-faint" />
          月度支出趋势
        </h4>
        <div class="h-48 flex items-center justify-center text-ink-faint text-13px">
          图表待实现 (#7)
        </div>
      </div>

      <!-- 支出构成环形图 45% -->
      <div class="border border-line bg-panel p-4">
        <h4 class="text-13px font-700 text-ink mb-3 flex items-center gap-1.5">
          <span class="i-lucide-chart-bar text-14px text-ink-faint" />
          支出构成
        </h4>
        <div class="h-48 flex items-center justify-center text-ink-faint text-13px">
          图表待实现 (#7)
        </div>
      </div>

      <!-- 票据税额柱状图 -->
      <div class="border border-line bg-panel p-4">
        <h4 class="text-13px font-700 text-ink mb-3 flex items-center gap-1.5">
          <span class="i-lucide-chart-bar text-14px text-ink-faint" />
          票据与税额
        </h4>
        <div class="h-48 flex items-center justify-center text-ink-faint text-13px">
          图表待实现 (#7)
        </div>
      </div>

      <!-- 施工进度甘特图 -->
      <div class="border border-line bg-panel p-4">
        <h4 class="text-13px font-700 text-ink mb-3 flex items-center gap-1.5">
          <span class="i-lucide-chart-bar text-14px text-ink-faint" />
          施工进度
        </h4>
        <div class="h-48 flex items-center justify-center text-ink-faint text-13px">
          图表待实现 (#7)
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-metrics {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 10rem), 1fr));
}

.dashboard-charts {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
}
</style>
