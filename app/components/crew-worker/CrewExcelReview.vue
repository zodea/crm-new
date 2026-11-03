<script setup lang="ts">
import type { CrewExcelPreview } from '~/lib/crew-worker/excel-import-contract'
import type { ImportTemplateField } from '~/lib/kit/import-mapping'
import { computed, shallowRef, watch } from 'vue'

export interface CrewExcelReviewEntry {
  index: number
  rowNumber: number
  row: Record<string, unknown>
  preview: CrewExcelPreview
  sameFileRows: number[]
}
const props = defineProps<{ entries: readonly CrewExcelReviewEntry[], fields: readonly ImportTemplateField[], choices: Readonly<Record<number, string>>, locked: boolean }>()
const emit = defineEmits<{ choose: [index: number, value: string] }>()
const page = shallowRef(1)
const pageCount = computed(() => Math.max(1, Math.ceil(props.entries.length / 10)))
const visible = computed(() => props.entries.slice((page.value - 1) * 10, page.value * 10))
watch(pageCount, (count) => {
  if (page.value > count)
    page.value = count
})
const label = (key: string) => props.fields.find(field => field.key === key)?.label ?? key
const text = (value: unknown) => value == null || value === '' ? '（空）' : Array.isArray(value) ? value.join('、') : typeof value === 'boolean' ? value ? '是' : '否' : String(value)
</script>

<template>
  <section v-if="entries.length" class="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" aria-label="班组重复资料核对">
    <h2 class="text-14px text-ink font-700">
      核对可能重复的 {{ entries.length }} 行
    </h2>
    <p class="text-12px text-ink-soft">
      请逐行选择处理方式。替换只修改文件映射的字段；跳过的行不会写入。
    </p>
    <article v-for="entry in visible" :key="entry.index" class="min-w-0 border border-line rounded-[var(--radius-card)] bg-panel p-3">
      <h3 class="text-13px font-700">
        第 {{ entry.rowNumber }} 行 · {{ text(entry.row.name) }}
      </h3>
      <p v-if="entry.sameFileRows.length" class="mt-2 text-12px text-danger" role="status">
        与文件中的第 {{ entry.sameFileRows.join('、') }} 行可能重复；请跳过重复行或返回修改文件。
      </p>
      <p v-if="entry.preview.candidates.some(candidate => candidate.name.trim() === String(entry.row.name ?? '').trim())" class="mt-2 text-12px text-ink-soft">
        班组名称已存在；请确认替换、跳过或修改名称。
      </p>
      <div v-for="candidate in entry.preview.candidates" :key="candidate.id" class="mt-3 border-t border-line pt-3">
        <p class="text-12px font-600">
          已有：{{ candidate.name }}
        </p>
        <div class="mt-2 overflow-x-auto" tabindex="0" aria-label="已有班组与导入内容对比">
          <table class="w-full min-w-[28rem] text-left text-12px">
            <thead><tr><th>字段</th><th>已有</th><th>文件</th></tr></thead>
            <tbody>
              <tr v-for="(oldValue, key) in candidate.fields" :key="key" class="border-t border-line">
                <td class="py-1 pr-3">
                  {{ label(String(key)) }}
                </td>
                <td class="py-1 pr-3">
                  {{ text(oldValue) }}
                </td>
                <td class="py-1">
                  {{ text(entry.row[String(key)]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <label class="mt-3 grid gap-1 text-12px">
        第 {{ entry.rowNumber }} 行处理方式
        <select :value="choices[entry.index] ?? ''" :disabled="locked" class="field-input w-full" :aria-label="`第 ${entry.rowNumber} 行处理方式`" @change="emit('choose', entry.index, ($event.target as HTMLSelectElement).value)">
          <option value="">请选择</option>
          <option value="skip">跳过此行</option>
          <option v-if="!entry.sameFileRows.length && !entry.preview.candidates.some(candidate => candidate.name.trim() === String(entry.row.name ?? '').trim())" value="create">仍然新建</option>
          <option v-for="candidate in entry.preview.candidates" :key="candidate.id" :value="`replace:${candidate.id}`">替换 {{ candidate.name }}（{{ candidate.id }}）</option>
        </select>
      </label>
    </article>
    <div v-if="pageCount > 1" class="flex items-center gap-2 text-12px">
      <button type="button" class="btn-secondary" :disabled="page === 1" @click="page--">
        上一页
      </button>
      <span>第 {{ page }} / {{ pageCount }} 页</span>
      <button type="button" class="btn-secondary" :disabled="page === pageCount" @click="page++">
        下一页
      </button>
    </div>
  </section>
</template>
