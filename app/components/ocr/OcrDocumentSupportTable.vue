<script setup lang="ts">
import type { KitTableColumn } from '~/lib/kit/table'
import type { OcrDocumentSupport } from '~/lib/ocr/settings'

defineProps<{
  rows: OcrDocumentSupport[]
}>()

const columns: KitTableColumn[] = [
  { field: 'documentType', title: '单据类型', width: 120 },
  { field: 'availability', title: '接入状态', width: 110, slot: 'availability' },
  { field: 'engine', title: '当前引擎', minWidth: 150 },
  { field: 'workflow', title: '真实处理链路', minWidth: 280 },
  { field: 'note', title: '人工边界', minWidth: 320 },
]
</script>

<template>
  <section class="min-w-0" aria-labelledby="ocr-document-support-title">
    <div class="mb-3">
      <h2 id="ocr-document-support-title" class="m-0 text-15px font-800 text-ink">
        单据接入矩阵
      </h2>
      <p class="m-0 mt-1 text-11px leading-5 text-ink-faint">
        同一 VL 引擎输出文档结果，各单据仍由独立规则解析器和人工核对流程负责。
      </p>
    </div>
    <KitTable
      :columns="columns"
      :data="rows"
      :min-rows="3"
      :resizable="false"
      row-key="id"
      data-testid="ocr-document-table"
    >
      <template #availability="{ row }">
        <span
          class="status-chip"
          :class="row.availability === 'available'
            ? 'bg-ok-soft text-ok-ink'
            : 'bg-surface-3 text-ink-faint'"
        >
          {{ row.availability === 'available' ? '已接入' : '未接入' }}
        </span>
      </template>
    </KitTable>
  </section>
</template>
