<script setup lang="ts">
import { nextTick, onMounted } from 'vue'
import { createPayrollWorkbookExport } from '~/lib/payroll/export'

const store = usePayrollStore()
const kit = useKitUI()

onMounted(store.load)

async function reload(filters: typeof store.filters) {
  Object.assign(store.filters, filters)
  await store.load()
}

async function run(action: () => Promise<void>, success: string) {
  try {
    await action()
    kit.success(success)
  }
  catch (cause) {
    kit.error(cause instanceof Error ? cause.message : String(cause))
  }
}

async function exportSelected() {
  if (!store.selected)
    return
  try {
    await kit.exportFile(createPayrollWorkbookExport(store.selected))
  }
  catch (cause) {
    kit.error(cause instanceof Error ? cause.message : String(cause))
  }
}

async function printSelected() {
  if (!store.selected || store.selected.status !== 'released')
    return
  await nextTick()
  window.print()
}
</script>

<template>
  <main class="payroll-screen">
    <header class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="text-11px font-700 text-brand">
          分包及人工
        </p>
        <h1 class="mt-1 text-20px font-800 text-ink">
          工资核算
        </h1>
        <p class="mt-1 text-12px text-ink-soft">
          负责人请款簿 · 草稿 → 已核对 → 已发放快照
        </p>
      </div>
      <p class="max-w-120 text-right text-11px leading-5 text-ink-faint">
        合同量仅用于收入、量差和毛利对照；工资预付可选暂估/现场，核对与发放固定现场量。
      </p>
    </header>

    <PayrollFilters
      :options="store.options"
      :filters="store.filters"
      @update:filters="reload"
      @create="input => run(() => store.createDraft(input), '工资草稿已生成')"
    />
    <PayrollSummary :statements="store.statements" />
    <p v-if="store.error" role="alert" class="rounded-md bg-danger-soft px-3 py-2 text-12px text-danger">
      {{ store.error }}
    </p>
    <div class="payroll-screen__workspace">
      <PayrollStatementTable
        :statements="store.statements"
        :selected-id="store.selectedId"
        :loading="store.loading"
        @select="store.selectedId = $event"
      />
      <PayrollStatementDetail
        :statement="store.selected"
        @update-price="(lineId, price) => run(() => store.updatePrice(lineId, price), '工资单价已更新')"
        @check="run(store.checkSelected, '已按现场复核量完成核对')"
        @release="(amount, allocations) => run(() => store.releaseSelected(amount, allocations), '实际发放与组内分配已登记并冻结快照')"
        @print="printSelected"
        @export="exportSelected"
      />
    </div>
  </main>
</template>

<style scoped>
.payroll-screen { display: grid; gap: 1rem; min-width: 0; }
.payroll-screen__workspace { display: grid; min-width: 0; gap: 1rem; }
@media (min-width: 1280px) {
  .payroll-screen__workspace { grid-template-columns: minmax(0, 1.25fr) minmax(22rem, .75fr); align-items: start; }
}
</style>
