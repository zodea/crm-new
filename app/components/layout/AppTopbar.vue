<script setup lang="ts">
const route = useRoute()

const pageTitle = computed(() => {
  const path = route.path
  if (path === '/') return '首页'
  if (path.startsWith('/project')) return '项目信息'
  if (path.startsWith('/base/supplier')) return '分供方'
  if (path.startsWith('/base/crew')) return '班组管理'
  if (path.startsWith('/base/worker')) return '工人信息'
  if (path.startsWith('/finance/invoice')) return '发票识别'
  if (path.startsWith('/finance')) return '资金管理'
  if (path.startsWith('/contract')) return '主合同管理'
  if (path.startsWith('/subcontract/quantity')) return '工程量管理'
  if (path.startsWith('/subcontract/payroll')) return '工资核算'
  if (path.startsWith('/subcontract')) return '分包及人工'
  if (path.startsWith('/material/delivery')) return '送货单识别'
  if (path.startsWith('/material/price')) return '单价对比'
  if (path.startsWith('/material')) return '乙供材管理'
  return ''
})
</script>

<template>
  <header
    class="flex items-center h-[var(--header-h)] px-4 border-b border-line bg-panel shrink-0"
  >
    <h1 class="text-17px font-500 text-ink">
      {{ pageTitle }}
    </h1>

    <div class="flex-1" />

    <!-- 通知 -->
    <button class="icon-btn mr-2" title="通知">
      <span class="i-lucide-bell-ring text-15px" />
    </button>

    <!-- 设置 -->
    <button class="icon-btn" title="设置">
      <span class="i-lucide-settings text-15px" />
    </button>
  </header>
</template>
