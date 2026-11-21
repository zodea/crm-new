<script setup lang="ts">
import type { RawImportSheet, RawImportWorkbook } from '~/lib/util/excel'
import { useDropZone } from '@vueuse/core'
import { shallowRef, useTemplateRef } from 'vue'
import { toErrorMessage } from '~/lib/util/error'
import { parseWorkbookForMapping } from '~/lib/util/excel'

const props = defineProps<{ chooseSheet?: boolean }>()
const emit = defineEmits<{
  loaded: [sheet: RawImportSheet]
}>()
const workbook = shallowRef<RawImportWorkbook | null>(null)
const selectedSheet = shallowRef('')

const parsing = shallowRef(false)
const error = shallowRef<string | null>(null)

const dropZone = useTemplateRef('dropZone')
const { isOverDropZone } = useDropZone(dropZone, {
  onDrop: files => handleFile(files?.[0]),
})

async function handleFile(file: File | undefined) {
  if (!file || parsing.value)
    return
  // 拖放路径不受 input accept 约束，统一在这里拦非表格文件，
  // 避免 SheetJS 把 PDF/二进制按文本兜底解析出乱码表头。
  if (!/\.(?:xlsx|xls|csv)$/i.test(file.name)) {
    error.value = '仅支持 .xlsx / .xls / .csv 文件'
    return
  }
  parsing.value = true
  error.value = null
  try {
    const parsed = await parseWorkbookForMapping(file)
    if (props.chooseSheet) {
      workbook.value = parsed
      selectedSheet.value = parsed.sheets.find(sheet => sheet.rows.length)?.name ?? ''
      return
    }
    const sheet = parsed.sheets[0]!
    if (!sheet.rows.length)
      throw new Error('文件没有数据行，请检查后重新上传')
    emit('loaded', sheet)
  }
  catch (cause) {
    error.value = toErrorMessage(cause)
  }
  finally {
    parsing.value = false
  }
}

function confirmSheet() {
  const sheet = workbook.value?.sheets.find(sheet => sheet.name === selectedSheet.value)
  if (!sheet?.rows.length) {
    error.value = '文件没有数据行，请检查后重新上传'
    return
  }
  emit('loaded', sheet)
}

function onPick(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  handleFile(input.files?.[0] ?? undefined)
  // 允许再次选择同一文件（例如修正内容后重新上传）。
  input.value = ''
}
</script>

<template>
  <section aria-label="上传数据文件">
    <label
      ref="dropZone"
      class="grid cursor-pointer place-items-center gap-2 border-2 rounded-[var(--radius-card)] border-dashed bg-panel p-8 text-center transition-colors duration-[var(--dur-fast)] focus-within:border-brand focus-within:[box-shadow:0_0_0_2px_var(--brand-soft)]"
      :class="isOverDropZone ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand/60'"
    >
      <span class="i-lucide-file-up h-7 w-7 text-brand" aria-hidden="true" />
      <span class="text-13px font-700 text-ink">拖入 Excel / CSV 文件，或点击选择</span>
      <span class="text-11px text-ink-faint">自动识别表头；支持 .xlsx / .xls / .csv</span>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        class="sr-only"
        aria-label="选择导入文件"
        @change="onPick"
      >
    </label>

    <div v-if="chooseSheet && workbook" class="mt-3 flex flex-wrap items-center gap-3">
      <label class="min-w-0 flex flex-wrap items-center gap-2 text-12px">
        工作表
        <select v-model="selectedSheet" aria-label="选择导入 Sheet" class="max-w-full min-w-0 border border-line rounded bg-panel px-3 py-2">
          <option v-for="item in workbook.sheets" :key="item.name" :value="item.name">
            {{ item.name }} · {{ item.rows.length }} 行
          </option>
        </select>
      </label>
      <button type="button" class="btn-primary" @click="confirmSheet">
        使用此工作表
      </button>
    </div>

    <p v-if="parsing" class="mt-3 text-12px text-ink-soft" role="status">
      正在解析文件…
    </p>
    <p v-else-if="error" class="mt-3 text-12px text-danger font-600" role="alert">
      {{ error }}
    </p>
  </section>
</template>
