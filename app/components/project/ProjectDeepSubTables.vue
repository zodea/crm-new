<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'

const props = defineProps<{
  tab: string
  projectId: string
}>()

const detailStore = useProjectDetailStore()

const targetCosts = computed(() =>
  detailStore.targetCosts.filter(row => row.projectId === props.projectId),
)
const targetCostCategories = computed(() =>
  detailStore.targetCostCategories.filter(row => row.projectId === props.projectId),
)

const targetCostColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'name', title: '目标成本版本', minWidth: 220, slot: 'link' },
  { field: 'status', title: '控制状态', width: 130, filterable: true },
  { field: 'targetAmount', title: '目标成本', type: 'money', width: 145 },
  { field: 'signedAmount', title: '已签合同', type: 'money', width: 145 },
  { field: 'settledAmount', title: '累计结算', type: 'money', width: 145 },
  { field: 'paidAmount', title: '累计支付', type: 'money', width: 145 },
  { field: 'remainingAmount', title: '目标余量', type: 'money', width: 145 },
]
const targetCategoryColumns: KitTableColumn[] = [
  { type: 'seq', title: '#' },
  { field: 'category', title: '成本分类', minWidth: 130, filterable: true },
  { field: 'targetAmount', title: '目标成本', type: 'money', width: 145 },
  { field: 'signedAmount', title: '已签合同', type: 'money', width: 145 },
  { field: 'settledAmount', title: '累计结算', type: 'money', width: 145 },
  { field: 'paidAmount', title: '累计支付', type: 'money', width: 145 },
  { field: 'remainingAmount', title: '目标余量', type: 'money', width: 145 },
  { field: 'source', title: '来源', minWidth: 280, slot: 'source' },
]
</script>

<template>
  <div v-if="tab === 'budget'" class="space-y-5">
    <ProjectSubTableSection
      title="目标成本版本"
      :columns="targetCostColumns"
      :rows="targetCosts"
      :loading="detailStore.loading"
      empty="当前项目尚未建立目标成本版本"
    >
      <template #link="{ row }">
        <NuxtLink :to="row.sourcePath" class="cell--link">
          {{ row.name || '查看目标成本' }}
        </NuxtLink>
      </template>
    </ProjectSubTableSection>

    <ProjectSubTableSection
      title="目标成本分类控制"
      :columns="targetCategoryColumns"
      :rows="targetCostCategories"
      :loading="detailStore.loading"
      :summary-fields="[
        { field: 'targetAmount', label: '目标成本合计' },
        { field: 'signedAmount', label: '已签合同合计' },
        { field: 'settledAmount', label: '累计结算合计' },
        { field: 'paidAmount', label: '累计支付合计' },
      ]"
      empty="当前项目尚无正式目标成本或成本事实"
    >
      <template #source="{ row }">
        <div class="flex flex-wrap gap-1">
          <NuxtLink v-if="row.targetLineCount" :to="row.targetPath" class="cell--link">
            目标 {{ row.targetLineCount }}
          </NuxtLink>
          <NuxtLink v-if="row.contractCount" :to="row.contractPath" class="cell--link">
            合同 {{ row.contractCount }}
          </NuxtLink>
          <NuxtLink v-if="row.settlementCount" :to="row.settlementPath" class="cell--link">
            结算 {{ row.settlementCount }}
          </NuxtLink>
          <NuxtLink v-if="row.paymentCount" :to="row.paymentPath" class="cell--link">
            支付 {{ row.paymentCount }}
          </NuxtLink>
          <NuxtLink v-if="row.reimbursementCount" :to="row.reimbursementPath" class="cell--link">
            报销 {{ row.reimbursementCount }}
          </NuxtLink>
          <span
            v-if="!(
              row.targetLineCount
              || row.contractCount
              || row.settlementCount
              || row.paymentCount
              || row.reimbursementCount
            )"
            class="text-ink-faint"
          >
            —
          </span>
        </div>
      </template>
    </ProjectSubTableSection>
  </div>
</template>
