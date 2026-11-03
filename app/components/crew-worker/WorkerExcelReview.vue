<script setup lang="ts">
import type { WorkerExcelPreview } from '~/lib/crew-worker/worker-excel-contract'
import type { ImportTemplateField } from '~/lib/kit/import-mapping'
import { computed, shallowRef, watch } from 'vue'

export interface WorkerExcelReviewEntry { index: number, rowNumber: number, row: Record<string, unknown>, preview: WorkerExcelPreview, sameFileRows: number[] }
const props = defineProps<{ entries: readonly WorkerExcelReviewEntry[], fields: readonly ImportTemplateField[], choices: Readonly<Record<number, string>>, relations: Readonly<Record<number, { crew?: string, project?: string }>>, locked: boolean }>()
const emit = defineEmits<{ choose: [index: number, value: string], relation: [index: number, kind: 'crew' | 'project', value: string] }>()
const page = shallowRef(1)
const pageCount = computed(() => Math.max(1, Math.ceil(props.entries.length / 10)))
const visible = computed(() => props.entries.slice((page.value - 1) * 10, page.value * 10))
watch(pageCount, (count) => {
  if (page.value > count)
    page.value = count
})
const label = (key: string) => props.fields.find(field => field.key === key)?.label ?? key
const show = (value: unknown) => value == null || value === '' ? '（空）' : Array.isArray(value) ? value.join('、') : typeof value === 'boolean' ? value ? '是' : '否' : String(value)
const matchLabel = { name: '姓名', idCard: '身份证', phone: '电话' }
</script>

<template>
  <section v-if="entries.length" class="mt-4 grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3" aria-label="工人资料与关联核对">
    <h2 class="text-14px text-ink font-700">
      核对工人和关联（{{ entries.length }} 行）
    </h2>
    <p class="text-12px text-ink-soft">
      同名不代表同一人。请核对已有资料，并明确选择班组及项目。
    </p>
    <article v-for="entry in visible" :key="entry.index" class="min-w-0 border border-line rounded-[var(--radius-card)] bg-panel p-3">
      <h3 class="text-13px font-700">
        第 {{ entry.rowNumber }} 行 · {{ show(entry.row.name) }}
      </h3>
      <p v-if="entry.sameFileRows.length" class="mt-2 text-12px text-danger" role="status">
        与文件中的第 {{ entry.sameFileRows.join('、') }} 行可能重复；请跳过多余行或分开修改后重新导入。
      </p>
      <p v-if="entry.preview.candidates.some(candidate => candidate.matchedBy.includes('idCard'))" class="mt-2 text-12px text-ink-soft">
        身份证号已关联已有工人，请确认替换或跳过。
      </p>
      <div v-for="candidate in entry.preview.candidates" :key="candidate.id" class="mt-3 border-t border-line pt-3">
        <p class="text-12px font-600">
          已有：{{ candidate.name }}（{{ candidate.matchedBy.map(key => matchLabel[key]).join('、') }}匹配）
        </p>
        <div class="mt-2 overflow-x-auto" tabindex="0" aria-label="已有工人与导入内容对比">
          <table class="w-full min-w-[28rem] text-left text-12px">
            <thead><tr><th>字段</th><th>已有</th><th>文件</th></tr></thead>
            <tbody>
              <tr v-for="(oldValue, key) in candidate.fields" :key="key" class="border-t border-line">
                <td class="py-1 pr-3">
                  {{ label(String(key)) }}
                </td><td class="py-1 pr-3">
                  {{ show(oldValue) }}
                </td><td class="py-1">
                  {{ show(entry.row[String(key)]) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <label class="mt-3 grid gap-1 text-12px">
        第 {{ entry.rowNumber }} 行处理方式
        <select :value="choices[entry.index] ?? ''" :disabled="locked" class="field-input w-full" :aria-label="`第 ${entry.rowNumber} 行处理方式`" @change="emit('choose', entry.index, ($event.target as HTMLSelectElement).value)">
          <option value="">请选择</option><option value="skip">跳过此行</option>
          <option v-if="!entry.sameFileRows.length && !entry.preview.candidates.some(candidate => candidate.matchedBy.includes('idCard'))" value="create">确认为不同人员，新建</option>
          <option v-for="candidate in entry.preview.candidates" :key="candidate.id" :value="`replace:${candidate.id}`">替换 {{ candidate.name }}（{{ candidate.id }}）</option>
        </select>
      </label>
      <template v-if="choices[entry.index] !== 'skip'">
        <label v-if="entry.row.crewName" class="mt-3 grid gap-1 text-12px">
          所属班组：{{ entry.row.crewName }}
          <select :value="relations[entry.index]?.crew ?? ''" :disabled="locked" class="field-input w-full" :aria-label="`第 ${entry.rowNumber} 行所属班组`" @change="emit('relation', entry.index, 'crew', ($event.target as HTMLSelectElement).value)">
            <option value="">{{ entry.preview.crews.length ? '请选择班组' : '未找到班组，请先维护班组' }}</option>
            <option v-for="candidate in entry.preview.crews" :key="candidate.id" :value="candidate.id">{{ candidate.name }}（{{ candidate.id }}）</option>
          </select>
        </label>
        <label v-if="entry.row.projectName" class="mt-3 grid gap-1 text-12px">
          当前项目：{{ entry.row.projectName }}
          <select :value="relations[entry.index]?.project ?? ''" :disabled="locked" class="field-input w-full" :aria-label="`第 ${entry.rowNumber} 行当前项目`" @change="emit('relation', entry.index, 'project', ($event.target as HTMLSelectElement).value)">
            <option value="">{{ entry.preview.projects.length ? '请选择项目' : '未找到项目，请先维护项目' }}</option>
            <option v-for="candidate in entry.preview.projects" :key="candidate.id" :value="candidate.id">{{ candidate.name }}（{{ candidate.id }}）</option>
          </select>
        </label>
      </template>
    </article>
    <div v-if="pageCount > 1" class="flex items-center gap-2 text-12px">
      <button type="button" class="btn-secondary" :disabled="page === 1" @click="page--">
        上一页
      </button><span>第 {{ page }} / {{ pageCount }} 页</span><button type="button" class="btn-secondary" :disabled="page === pageCount" @click="page++">
        下一页
      </button>
    </div>
  </section>
</template>
