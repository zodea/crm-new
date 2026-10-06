<script setup lang="ts">
import type { ContractFormAttachmentDraft, ContractLineItemDraft } from '~/lib/contract/forms'
import type { ImportColumnMatch } from '~/lib/kit/import-mapping'
import type { MaterialContractLineImportRow } from '~/lib/material-contract/import'
import type { RawImportWorkbook } from '~/lib/util/excel'
import { computed, ref } from 'vue'
import { fileRefDraftFromFile } from '~/lib/forms/file-refs'
import { DRAFT_IMPORT_TEMPLATES } from '~/lib/kit/import-entities'
import { autoMatchColumns, computeFieldStatus, listMissingRequiredFields } from '~/lib/kit/import-mapping'
import { appendMaterialContractLineImport, materialContractLineImportErrors, prepareMaterialContractLineImport } from '~/lib/material-contract/import'
import { exportToXlsx, parseWorkbookForMapping } from '~/lib/util/excel'

const props = defineProps<{ lines: ContractLineItemDraft[] }>()
const emit = defineEmits<{ append: [lines: ContractLineItemDraft[], original: ContractFormAttachmentDraft] }>()
const fields = DRAFT_IMPORT_TEMPLATES['material-contract-lines'].fields
const workbook = ref<RawImportWorkbook | null>(null)
const original = ref<ContractFormAttachmentDraft | null>(null)
const sheetIndex = ref(0)
const mapping = ref<Record<string, ImportColumnMatch>>({})
const rows = ref<MaterialContractLineImportRow[]>([])
const loading = ref(false)
const message = ref('')
const sheet = computed(() => workbook.value?.sheets[sheetIndex.value] ?? null)
const statuses = computed(() => computeFieldStatus(mapping.value, fields))
const pendingMapping = computed(() => listMissingRequiredFields(mapping.value, fields).length > 0
  || Object.values(mapping.value).some(match => match.confidence !== 'confirmed'))
const rowErrors = computed(() => rows.value.map(materialContractLineImportErrors))
const canAppend = computed(() => rows.value.length > 0 && rowErrors.value.every(errors => errors.length === 0))

function selectSheet(index: number) {
  sheetIndex.value = index
  mapping.value = sheet.value ? autoMatchColumns(sheet.value.columns, fields) : {}
  rows.value = []
  message.value = ''
}

async function upload(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file)
    return
  loading.value = true
  message.value = ''
  rows.value = []
  original.value = null
  try {
    if (file.size > 10 * 1024 * 1024)
      throw new Error('材采导入原件单份不能超过 10 MiB。')
    original.value = await fileRefDraftFromFile(file, { category: '材采导入原件' })
    workbook.value = await parseWorkbookForMapping(file)
    selectSheet(0)
  }
  catch (cause) {
    workbook.value = null
    original.value = null
    message.value = cause instanceof Error ? cause.message : '文件读取失败'
  }
  finally {
    loading.value = false
    input.value = ''
  }
}

function selectColumn(key: string, column: string) {
  const next = { ...mapping.value }
  if (column)
    next[key] = { column, confidence: 'confirmed' }
  else
    delete next[key]
  mapping.value = next
  rows.value = []
}

function preview() {
  if (!sheet.value || pendingMapping.value)
    return
  rows.value = prepareMaterialContractLineImport(sheet.value, mapping.value)
  message.value = rows.value.length ? '' : '工作表没有可追加的材料行'
}

function correct(index: number, key: string, value: string) {
  const row = rows.value[index]
  if (!row)
    return
  row.values = { ...row.values, [key]: value }
  row.verified = false
}

function append() {
  try {
    if (!original.value)
      throw new Error('导入原件未完成读取，请重新选择文件。')
    const appended = appendMaterialContractLineImport(props.lines, rows.value)
    emit('append', appended, original.value)
    workbook.value = null
    original.value = null
    rows.value = []
    message.value = '已整批追加到当前合同草稿，请保存合同完成写入'
  }
  catch (cause) {
    message.value = cause instanceof Error ? cause.message : '本次未追加'
  }
}

function downloadTemplate() {
  exportToXlsx([], fields.map(field => ({ header: field.label, key: field.key, width: 18 })), '材采明细', '材料采购合同明细模板.xlsx')
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden p-4" aria-label="材料文件导入" data-testid="material-contract-file-import">
    <div class="flex flex-wrap items-center gap-2">
      <strong class="mr-auto text-13px">材料文件导入</strong>
      <button type="button" class="btn-secondary" @click="downloadTemplate">
        下载导入模板
      </button>
      <label class="btn-secondary">
        {{ loading ? '正在读取…' : '选择 Excel / CSV' }}
        <input type="file" class="sr-only" accept=".xlsx,.xls,.csv" :disabled="loading" data-testid="material-contract-file" @change="upload">
      </label>
    </div>
    <p class="mt-2 text-12px text-ink-soft">
      导入当前合同的新材料行；保留已有行。核对原行数量、计量单位及计价单位，全部通过后整批追加。
    </p>
    <p v-if="message" class="mt-2 text-12px" role="status">
      {{ message }}
    </p>
    <template v-if="sheet">
      <label class="field-block mt-3">
        <span class="field-label">工作表</span>
        <select class="field-input" :value="sheetIndex" aria-label="材采导入工作表" @change="selectSheet(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="(item, index) in workbook?.sheets" :key="item.name" :value="index">{{ item.name }}</option>
        </select>
      </label>
      <div class="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <label v-for="field in fields" :key="field.key" class="field-block">
          <span class="field-label">{{ field.label }}{{ field.required ? ' *' : '' }}</span>
          <select class="field-input" :value="mapping[field.key]?.column ?? ''" :aria-label="`${field.label}来源列`" @change="selectColumn(field.key, ($event.target as HTMLSelectElement).value)">
            <option value="">不映射</option>
            <option v-for="column in sheet.columns" :key="column" :value="column">{{ column }}</option>
          </select>
          <span v-if="statuses[field.key] === 'pending'" class="text-12px text-warn">建议匹配，请选定确认</span>
          <span v-else-if="statuses[field.key] === 'required-missing'" class="text-12px text-danger">必填来源列未选定</span>
        </label>
      </div>
      <button type="button" class="btn-secondary mt-3" :disabled="pendingMapping" data-testid="material-contract-preview" @click="preview">
        预览并核对
      </button>
      <div v-if="rows.length" class="mt-3 min-w-0 overflow-x-auto" tabindex="0" aria-label="材料导入预览横向滚动" data-testid="material-contract-import-scroll">
        <table class="w-full min-w-1400px text-12px">
          <thead>
            <tr>
              <th class="p-2 text-left">
                源行
              </th><th v-for="field in fields" :key="field.key" class="p-2 text-left">
                {{ field.label }}
              </th><th class="p-2 text-left">
                核对
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="`${row.source.sheetName}:${row.source.rowNumber}`">
              <td class="p-2 align-top">
                {{ row.source.rowNumber }}
              </td>
              <td v-for="field in fields" :key="field.key" class="p-1 align-top">
                <input class="field-input min-w-100px" :value="row.values[field.key]" :aria-label="`${field.label}，源第 ${row.source.rowNumber} 行`" @input="correct(index, field.key, ($event.target as HTMLInputElement).value)">
              </td>
              <td class="min-w-240px p-2 align-top">
                <label class="inline-flex gap-2"><input v-model="row.verified" type="checkbox" :aria-label="`数量与单位已核实，源第 ${row.source.rowNumber} 行`">数量与单位已核实</label>
                <p v-for="error in rowErrors[index]" :key="error" class="mt-1 text-danger">
                  {{ error }}
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <button v-if="rows.length" type="button" class="btn-primary mt-3" :disabled="!canAppend" data-testid="material-contract-append-import" @click="append">
        整批追加到合同草稿
      </button>
    </template>
  </section>
</template>
