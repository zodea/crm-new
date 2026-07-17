<script setup lang="ts">
import type { DeepReadonly } from 'vue'
import type { SupplierMatch } from '~/lib/delivery/match'
import type { DeliveryDoc, DeliveryFile, DeliveryItem, DeliveryReviewInput } from '~/stores/delivery'
import type { Project } from '~/stores/project'
import type { Supplier } from '~/stores/supplier'
import { generateId } from '~/lib/util/id'
import { yuan } from '~/lib/util/money'
import { round2 } from '~/lib/util/number'

defineProps<{
  file?: DeliveryFile
  document?: DeliveryDoc
  documents: readonly DeliveryDoc[]
  projects: readonly DeepReadonly<Project>[]
  suppliers: readonly DeepReadonly<Supplier>[]
  supplierSuggestion: SupplierMatch | null
  saving: boolean
}>()

const emit = defineEmits<{
  selectDocument: [id: string]
  archive: []
  recognize: []
}>()

const draft = defineModel<DeliveryReviewInput | null>({ required: true })

function addLine() {
  if (!draft.value)
    return
  draft.value.items.push({
    id: generateId('ditem'),
    name: '',
    spec: '',
    unit: '',
    qty: 0,
    unitPrice: 0,
    amount: 0,
    note: '',
  })
}

function removeLine(index: number) {
  draft.value?.items.splice(index, 1)
}

function lineAmount(item: DeliveryItem): number {
  return round2(Number(item.qty || 0) * Number(item.unitPrice || 0))
}

const editableTotal = computed(() => draft.value?.items.reduce((sum, item) => sum + lineAmount(item), 0) ?? 0)
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]">
    <div class="flex min-h-11 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
      <div>
        <div class="text-11px font-800 text-ink">
          识别结果校对
        </div>
        <div class="text-9px text-ink-faint">
          核对完成后自动进入归档库
        </div>
      </div>
      <div class="flex-1" />
      <NuxtLink to="/material/delivery/archive" class="btn-secondary px-2.5 py-1.5 text-10px">
        <span class="i-lucide-archive mr-1" />归档库
      </NuxtLink>
    </div>

    <template v-if="file && document && draft">
      <div v-if="documents.length > 1" class="flex shrink-0 gap-1 overflow-x-auto border-b border-line px-3 py-2">
        <button
          v-for="(doc, index) in documents"
          :key="doc.id"
          type="button"
          class="shrink-0 rounded-[var(--radius-btn)] px-2.5 py-1 text-10px font-600"
          :class="doc.id === document.id ? 'bg-brand text-white' : 'bg-surface-3 text-ink-soft hover:bg-brand-soft'"
          @click="emit('selectDocument', doc.id)"
        >
          第 {{ index + 1 }} 张{{ doc.orderNo ? ` · ${doc.orderNo}` : '' }}
        </button>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto p-3">
        <div v-if="document.note" class="mb-3 flex gap-2 rounded-[var(--radius-btn)] border border-warn/40 bg-warn-soft px-3 py-2 text-10px text-warn-ink">
          <span class="i-lucide-triangle-alert mt-0.5 shrink-0" />
          <span>{{ document.note }}</span>
        </div>

        <section>
          <div class="mb-2 flex items-center gap-2">
            <span class="text-11px font-800 text-ink">单据信息</span>
            <span v-if="document.balanced" class="chip-ok text-9px">金额已勾稽</span>
            <span v-else class="chip-warn text-9px">金额待复核</span>
          </div>
          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="field-label">所属项目 <span class="text-danger">*</span></label>
              <select v-model="draft.projectId" class="field-input w-full" :class="!draft.projectId ? 'border-danger' : ''">
                <option value="" disabled>
                  请选择项目
                </option>
                <option v-for="project in projects" :key="project.id" :value="project.id">
                  {{ project.name }}
                </option>
              </select>
            </div>
            <div>
              <label class="field-label">分供方</label>
              <select v-model="draft.supplierId" class="field-input w-full">
                <option :value="null">
                  未区分分供方
                </option>
                <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">
                  {{ supplier.name }}
                </option>
              </select>
              <div class="mt-1 flex min-w-0 items-center gap-1 text-9px">
                <span class="shrink-0 text-ink-faint">OCR:</span>
                <span class="truncate text-ink-soft" :title="document.supplierText || file.supplierText">
                  {{ document.supplierText || file.supplierText || '未识别' }}
                </span>
                <span
                  v-if="supplierSuggestion"
                  class="chip shrink-0 text-8px"
                  :class="supplierSuggestion.kind === 'exact' ? 'chip-ok' : 'chip-warn'"
                >
                  {{ supplierSuggestion.kind === 'exact' ? '已匹配' : `模糊 ${Math.round(supplierSuggestion.score * 100)}%` }}
                </span>
              </div>
            </div>
            <div>
              <label class="field-label">单号</label>
              <input v-model="draft.orderNo" class="field-input w-full font-mono" :class="!draft.orderNo && draft.docType !== '收据' ? 'border-warn' : ''" placeholder="未识别时可手工填写">
            </div>
            <div>
              <label class="field-label">日期</label>
              <input v-model="draft.deliveryDate" type="date" class="field-input w-full font-mono" :class="!draft.deliveryDate ? 'border-warn' : ''">
            </div>
            <div>
              <label class="field-label">单据类型</label>
              <select v-model="draft.docType" class="field-input w-full">
                <option value="">
                  未区分
                </option>
                <option value="送货单">
                  送货单
                </option>
                <option value="销售单">
                  销售单
                </option>
                <option value="出货单">
                  出货单
                </option>
                <option value="收据">
                  收据
                </option>
              </select>
            </div>
            <div>
              <label class="field-label">工地原文</label>
              <input v-model="draft.siteText" class="field-input w-full" placeholder="OCR 原文，仅留痕">
            </div>
            <div class="col-span-2">
              <label class="field-label">复核备注</label>
              <input v-model="draft.note" class="field-input w-full" placeholder="金额差异、手写内容或人工说明">
            </div>
          </div>
        </section>

        <section class="mt-4">
          <div class="mb-2 flex items-center gap-2">
            <span class="text-11px font-800 text-ink">材料明细</span>
            <span class="text-9px text-ink-faint">{{ draft.items.length }} 行 · {{ yuan(editableTotal) }}</span>
            <div class="flex-1" />
            <button type="button" class="btn-secondary px-2 py-1 text-10px" @click="addLine">
              <span class="i-lucide-plus mr-1" />添加行
            </button>
          </div>

          <div class="overflow-x-auto rounded-[var(--radius-btn)] border border-line">
            <table class="min-w-[760px] w-full text-10px">
              <thead class="bg-surface-2 text-ink-soft">
                <tr>
                  <th class="w-8 px-1 py-1.5 text-center">
                    #
                  </th>
                  <th class="min-w-36 px-1 py-1.5 text-left">
                    材料名称
                  </th>
                  <th class="min-w-25 px-1 py-1.5 text-left">
                    规格
                  </th>
                  <th class="w-16 px-1 py-1.5 text-left">
                    单位
                  </th>
                  <th class="w-20 px-1 py-1.5 text-right">
                    数量
                  </th>
                  <th class="w-22 px-1 py-1.5 text-right">
                    单价
                  </th>
                  <th class="w-24 px-2 py-1.5 text-right">
                    金额
                  </th>
                  <th class="w-9 px-1 py-1.5" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="(item, index) in draft.items" :key="item.id" class="border-t border-line">
                  <td class="px-1 text-center font-mono text-ink-faint">
                    {{ index + 1 }}
                  </td>
                  <td class="p-0.5">
                    <input v-model="item.name" class="field-input w-full px-1.5 py-1 text-10px" placeholder="材料名称">
                  </td>
                  <td class="p-0.5">
                    <input v-model="item.spec" class="field-input w-full px-1.5 py-1 text-10px" placeholder="规格">
                  </td>
                  <td class="p-0.5">
                    <input v-model="item.unit" class="field-input w-full px-1.5 py-1 text-10px" placeholder="单位">
                  </td>
                  <td class="p-0.5">
                    <input v-model.number="item.qty" type="number" step="0.001" class="field-input w-full px-1.5 py-1 text-right font-mono text-10px">
                  </td>
                  <td class="p-0.5">
                    <input v-model.number="item.unitPrice" type="number" step="0.01" class="field-input w-full px-1.5 py-1 text-right font-mono text-10px">
                  </td>
                  <td class="px-2 text-right font-mono font-700">
                    {{ yuan(lineAmount(item)) }}
                  </td>
                  <td class="px-1 text-center">
                    <button type="button" class="icon-btn-danger h-6 w-6" title="删除明细" @click="removeLine(index)">
                      <span class="i-lucide-x text-11px" />
                    </button>
                  </td>
                </tr>
                <tr v-if="!draft.items.length">
                  <td colspan="8" class="px-3 py-6 text-center text-ink-faint">
                    未识别到材料明细，请手工添加
                  </td>
                </tr>
              </tbody>
              <tfoot class="border-t border-line bg-surface-2">
                <tr>
                  <td colspan="6" class="px-2 py-2 text-right font-600 text-ink-soft">
                    复核后合计
                  </td>
                  <td class="px-2 py-2 text-right font-mono text-12px font-800 text-brand-deep">
                    {{ yuan(editableTotal) }}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      </div>

      <div class="flex shrink-0 items-center gap-2 border-t border-line bg-surface-2 px-3 py-2.5">
        <button type="button" class="btn-secondary" :disabled="saving" @click="emit('recognize')">
          <span class="i-lucide-refresh-cw mr-1 text-12px" />重新识别
        </button>
        <div class="flex-1" />
        <span class="text-9px text-ink-faint">项目必选；分供方可留“未区分”</span>
        <button type="button" class="btn-primary" :disabled="saving" @click="emit('archive')">
          <span :class="saving ? 'i-lucide-loader-circle animate-spin' : 'i-lucide-circle-check'" class="mr-1 text-12px" />
          {{ saving ? '归档中…' : '核对完成并归档' }}
        </button>
      </div>
    </template>

    <div v-else-if="file?.ocrStatus === 'processing'" class="flex flex-1 flex-col items-center justify-center text-11px text-brand">
      <span class="i-lucide-loader-circle mb-2 animate-spin text-24px" />
      PaddleOCR-VL 正在识别版面与表格…
    </div>
    <div v-else-if="file?.ocrStatus === 'failed'" class="flex flex-1 flex-col items-center justify-center px-8 text-center">
      <span class="i-lucide-circle-alert mb-2 text-24px text-danger" />
      <p class="text-11px text-danger">
        {{ file.ocrError }}
      </p>
      <button type="button" class="btn-secondary mt-3" @click="emit('recognize')">
        重新识别
      </button>
    </div>
    <div v-else-if="file" class="flex flex-1 flex-col items-center justify-center text-11px text-ink-faint">
      <span class="i-lucide-scan-text mb-2 text-24px" />
      等待识别
      <button type="button" class="btn-primary mt-3" @click="emit('recognize')">
        开始识别
      </button>
    </div>
    <div v-else class="flex flex-1 flex-col items-center justify-center text-11px text-ink-faint">
      <span class="i-lucide-mouse-pointer-click mb-2 text-24px" />
      从左侧队列选择一个文件
    </div>
  </section>
</template>
