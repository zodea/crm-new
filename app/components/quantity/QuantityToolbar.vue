<script setup lang="ts">
import type { QuantityMatrixViewMode, QuantityOption } from '~/lib/quantity/matrix'

withDefaults(defineProps<{
  projectOptions: QuantityOption[]
  buildingOptions: QuantityOption[]
  monthOptions: QuantityOption[]
  tradeOptions: QuantityOption[]
  assigneeOptions: QuantityOption[]
  loading?: boolean
  activeUnits?: number
  totalUnits?: number
  matrixArchivedAt?: string | null
  scheduleScopeLabel?: string
}>(), {
  loading: false,
  activeUnits: 0,
  totalUnits: 0,
  matrixArchivedAt: null,
  scheduleScopeLabel: '',
})

const emit = defineEmits<{
  batchComplete: []
  exportLedger: []
  exportByCategory: []
  importData: []
  manageAssignments: []
  manageTemplates: []
  toggleArchive: []
  refresh: []
}>()

const projectId = defineModel<string>('projectId', { required: true })
const buildingId = defineModel<string>('buildingId', { required: true })
const month = defineModel<string>('month', { required: true })
const viewMode = defineModel<QuantityMatrixViewMode>('viewMode', { required: true })
const trade = defineModel<string>('trade', { required: true })
const assigneeKey = defineModel<string>('assigneeKey', { required: true })

const viewTabs = [
  { key: 'trade', label: '工种矩阵' },
  { key: 'crew', label: '班组矩阵' },
]
</script>

<template>
  <section class="quantity-toolbar panel min-w-0 px-4 py-3" aria-label="工程量筛选">
    <div class="quantity-toolbar__filters flex min-w-0 flex-wrap items-center gap-3">
      <SelectFilter
        v-model="projectId"
        label="项目"
        :options="projectOptions"
        :min-width="176"
      />
      <SelectFilter
        v-if="buildingOptions.length && !scheduleScopeLabel"
        v-model="buildingId"
        label="楼栋"
        :options="buildingOptions"
        :min-width="108"
      />
      <div v-if="scheduleScopeLabel" class="grid gap-1 text-12px">
        <span class="font-700 text-ink-soft">排程范围</span>
        <span class="field-input min-w-36 bg-brand-soft text-brand-deep">{{ scheduleScopeLabel }}</span>
      </div>
      <SelectFilter
        v-if="monthOptions.length"
        v-model="month"
        label="月份"
        :options="monthOptions"
        :min-width="132"
      />
      <SelectFilter
        v-if="viewMode === 'trade' && tradeOptions.length"
        v-model="trade"
        label="工种"
        :options="tradeOptions"
        :min-width="124"
      />
      <SelectFilter
        v-if="viewMode === 'crew' && assigneeOptions.length"
        v-model="assigneeKey"
        label="班组/个人"
        :options="assigneeOptions"
        :min-width="164"
      />

      <div class="quantity-toolbar__right ml-auto flex min-w-0 flex-wrap items-center justify-end gap-3">
        <span v-if="matrixArchivedAt" class="status-warn">
          已归档 {{ matrixArchivedAt.slice(0, 10) }}
        </span>
        <span class="text-12px text-ink-soft" aria-live="polite">
          有责任或进度 <b class="font-mono text-ink">{{ activeUnits }}</b> / {{ totalUnits }} 户
        </span>
        <button type="button" class="btn-primary" @click="emit('batchComplete')">
          <span class="i-lucide-list-checks mr-1 text-13px" aria-hidden="true" />
          批量完成
        </button>
        <button type="button" class="btn-secondary" @click="emit('manageAssignments')">
          <span class="i-lucide-users-round mr-1 text-13px" aria-hidden="true" />
          责任配置
        </button>
        <button type="button" class="btn-secondary" @click="emit('manageTemplates')">
          <span class="i-lucide-layout-template mr-1 text-13px" aria-hidden="true" />
          户型模板
        </button>
        <button type="button" class="btn-secondary" :disabled="loading" @click="emit('importData')">
          <span class="i-lucide-file-up mr-1 text-13px" aria-hidden="true" />
          导入
        </button>
        <button type="button" class="btn-secondary" :disabled="loading" @click="emit('exportLedger')">
          <span class="i-lucide-file-down mr-1 text-13px" aria-hidden="true" />
          导出台账
        </button>
        <button type="button" class="btn-secondary" :disabled="loading" @click="emit('exportByCategory')">
          <span class="i-lucide-folder-tree mr-1 text-13px" aria-hidden="true" />
          分类导出
        </button>
        <button type="button" class="btn-secondary" :disabled="loading" @click="emit('toggleArchive')">
          <span :class="matrixArchivedAt ? 'i-lucide-archive-restore' : 'i-lucide-archive'" class="mr-1 text-13px" aria-hidden="true" />
          {{ matrixArchivedAt ? '解除归档' : '归档矩阵' }}
        </button>
        <button type="button" class="btn-secondary" :disabled="loading" @click="emit('refresh')">
          <span class="i-lucide-refresh-cw mr-1 text-13px" aria-hidden="true" />
          刷新
        </button>
      </div>
    </div>

    <div class="mt-3 border-t border-line pt-1">
      <SegTab v-model="viewMode" :tabs="viewTabs" />
    </div>
  </section>
</template>

<style scoped>
.quantity-toolbar {
  container-type: inline-size;
}

@container (max-width: 47.999rem) {
  .quantity-toolbar__filters {
    align-items: flex-start;
  }

  .quantity-toolbar__right {
    width: 100%;
    margin-left: 0;
    justify-content: space-between;
  }
}

@container (max-width: 27rem) {
  .quantity-toolbar__filters :deep(label) {
    width: 100%;
    justify-content: space-between;
  }

  .quantity-toolbar__filters :deep(label > button) {
    min-width: min(72%, 13rem) !important;
  }
}
</style>
