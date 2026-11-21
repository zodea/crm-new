<script setup lang="ts">
import type {
  ProjectSupplierFileCategory,
  ProjectSupplierImportItem,
  ProjectSupplierImportSupplier,
} from '~/lib/supplier/import'
import { useDropZone, useStepper } from '@vueuse/core'
import { computed, shallowRef, useTemplateRef } from 'vue'
import {
  classifyProjectSupplierImportFile,
  inferProjectSupplierName,
  PROJECT_SUPPLIER_FILE_CATEGORIES,
} from '~/lib/supplier/import'

const props = defineProps<{
  projectName: string
  suppliers: readonly ProjectSupplierImportSupplier[]
  existingSupplierIds: ReadonlySet<string>
  busy?: boolean
}>()

const emit = defineEmits<{
  confirm: [items: readonly ProjectSupplierImportItem[]]
}>()

const stepper = useStepper(['files', 'classify', 'confirm'] as const, 'files')
const items = shallowRef<ProjectSupplierImportItem[]>([])
const dropZoneRef = useTemplateRef<HTMLElement>('dropZoneRef')
const fileInputRef = useTemplateRef<HTMLInputElement>('fileInputRef')
const folderInputRef = useTemplateRef<HTMLInputElement>('folderInputRef')

const processSteps = computed(() => [
  {
    id: 'files',
    label: '选择文件',
    status: stepper.isCurrent('files') ? 'active' as const : stepper.isAfter('files') ? 'completed' as const : 'pending' as const,
  },
  {
    id: 'classify',
    label: '分类与调整',
    status: stepper.isCurrent('classify') ? 'active' as const : stepper.isAfter('classify') ? 'completed' as const : 'pending' as const,
  },
  {
    id: 'confirm',
    label: '确认生成',
    status: stepper.isCurrent('confirm') ? 'active' as const : 'pending' as const,
  },
])

const canReview = computed(() => items.value.length > 0)
const unresolvedItems = computed(() => items.value.filter(item =>
  !item.supplierId && (!item.supplierName.trim() || !item.createSupplierConfirmed),
))
const relationGroups = computed(() => {
  const groups = new Map<string, {
    key: string
    supplierId: string
    supplierName: string
    existing: boolean
    createsSupplier: boolean
    items: ProjectSupplierImportItem[]
  }>()
  for (const item of items.value) {
    const key = item.supplierId || `new:${item.supplierName.trim().toLocaleLowerCase('zh-CN')}`
    const group = groups.get(key) ?? {
      key,
      supplierId: item.supplierId,
      supplierName: item.supplierName.trim(),
      existing: Boolean(item.supplierId && props.existingSupplierIds.has(item.supplierId)),
      createsSupplier: !item.supplierId,
      items: [],
    }
    group.items.push(item)
    groups.set(key, group)
  }
  return [...groups.values()]
})

function fileKey(file: File): string {
  return `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`
}

function addFiles(files: readonly File[]) {
  const existingKeys = new Set(items.value.map(item => item.key))
  const additions = files
    .filter(file => !existingKeys.has(fileKey(file)))
    .map((file): ProjectSupplierImportItem => ({
      key: fileKey(file),
      file,
      ...classifyProjectSupplierImportFile(file.name, props.suppliers, props.projectName),
      createSupplierConfirmed: false,
    }))
  if (additions.length)
    items.value = [...items.value, ...additions]
}

function onPick(event: Event) {
  const input = event.currentTarget as HTMLInputElement
  addFiles(input.files ? [...input.files] : [])
  input.value = ''
}

const { isOverDropZone } = useDropZone(dropZoneRef, {
  multiple: true,
  onDrop(files) {
    addFiles(files ?? [])
  },
})

function removeFile(key: string) {
  items.value = items.value.filter(item => item.key !== key)
}

function updateSupplier(item: ProjectSupplierImportItem, supplierId: string) {
  if (supplierId === '__new__') {
    items.value = items.value.map(candidate => candidate.key === item.key
      ? {
          ...candidate,
          supplierId: '',
          supplierName: candidate.matchSource === 'unmatched'
            ? candidate.supplierName
            : inferProjectSupplierName(candidate.file.name, props.projectName),
          matchSource: 'unmatched',
          createSupplierConfirmed: false,
        }
      : candidate)
    return
  }
  const supplier = props.suppliers.find(candidate => candidate.id === supplierId)
  if (!supplier)
    return
  items.value = items.value.map(candidate => candidate.key === item.key
    ? {
        ...candidate,
        supplierId,
        supplierName: supplier.name,
        matchSource: 'name',
        createSupplierConfirmed: false,
      }
    : candidate)
}

function updateItem(
  item: ProjectSupplierImportItem,
  patch: Partial<Pick<ProjectSupplierImportItem, 'category' | 'supplierName' | 'createSupplierConfirmed'>>,
) {
  items.value = items.value.map(candidate =>
    candidate.key === item.key ? { ...candidate, ...patch } : candidate,
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function fileType(file: File): string {
  return file.type || file.name.split('.').pop()?.toLocaleUpperCase('zh-CN') || '未知'
}

function goToClassify() {
  if (canReview.value)
    stepper.goTo('classify')
}

function goToConfirm() {
  if (!unresolvedItems.value.length)
    stepper.goTo('confirm')
}
</script>

<template>
  <div class="min-w-0 space-y-4 [container-type:inline-size]">
    <section class="panel p-4">
      <ProcessStepper :steps="processSteps" />
    </section>

    <section v-if="stepper.isCurrent('files')" class="panel p-4">
      <div
        ref="dropZoneRef"
        class="grid min-h-56 place-items-center border-2 rounded-[var(--radius-card)] border-dashed p-6 text-center transition-colors"
        :class="isOverDropZone ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface-2'"
      >
        <div>
          <span class="i-lucide-folder-up text-36px text-brand" aria-hidden="true" />
          <h2 class="mt-3 text-15px font-800 text-ink">
            选择要归档到项目分供方的文件
          </h2>
          <p class="mt-1 text-12px text-ink-soft">
            可拖入多个文件，或选择文件夹。识别仅依据文件名，不上传云端、不执行 OCR。
          </p>
          <div class="mt-4 flex flex-wrap justify-center gap-2">
            <button type="button" class="btn-accent" @click="fileInputRef?.click()">
              选择文件
            </button>
            <button type="button" class="btn-secondary" @click="folderInputRef?.click()">
              选择文件夹
            </button>
            <input
              ref="fileInputRef"
              type="file"
              multiple
              class="sr-only"
              aria-label="选择项目分供方文件"
              @change="onPick"
            >
            <input
              ref="folderInputRef"
              type="file"
              multiple
              webkitdirectory
              class="sr-only"
              aria-label="选择项目分供方文件夹"
              @change="onPick"
            >
          </div>
        </div>
      </div>

      <div v-if="items.length" class="mt-4 overflow-x-auto border border-line">
        <table class="w-full min-w-640px border-collapse text-left text-12px">
          <thead class="bg-surface-2 text-ink-soft">
            <tr>
              <th class="px-3 py-2 font-700">
                文件名
              </th>
              <th class="px-3 py-2 font-700">
                大小
              </th>
              <th class="px-3 py-2 font-700">
                类型
              </th>
              <th class="w-20 px-3 py-2 font-700">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in items" :key="item.key" class="border-t border-line">
              <td class="max-w-96 truncate px-3 py-2 text-ink" :title="item.file.name">
                {{ item.file.webkitRelativePath || item.file.name }}
              </td>
              <td class="px-3 py-2 font-mono text-ink-soft">
                {{ formatSize(item.file.size) }}
              </td>
              <td class="px-3 py-2 text-ink-soft">
                {{ fileType(item.file) }}
              </td>
              <td class="px-3 py-2">
                <button type="button" class="btn-ghost px-2 py-1 text-danger" @click="removeFile(item.key)">
                  移除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <StatePanel
        v-else
        kind="empty"
        title="尚未选择文件"
        description="至少添加一个文件后才能进入分类。"
        compact
      />
      <div class="mt-4 flex justify-end">
        <button type="button" class="btn-accent" :disabled="!canReview" @click="goToClassify">
          下一步：自动分类
        </button>
      </div>
    </section>

    <section v-else-if="stepper.isCurrent('classify')" class="panel overflow-hidden">
      <div class="border-b border-line bg-surface-2 px-4 py-3">
        <h2 class="text-14px font-800 text-ink">
          自动分类与人工调整
        </h2>
        <p class="mt-0.5 text-11px text-ink-soft">
          已按文件名匹配现有分供方及文件类别；请逐项核对。未匹配项只有勾选确认后才会新建分供方主数据。
        </p>
      </div>
      <div class="divide-y divide-line">
        <article
          v-for="item in items"
          :key="item.key"
          class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,14rem),1fr))] gap-3 p-4"
        >
          <div class="min-w-0">
            <div class="truncate text-13px font-700 text-ink" :title="item.file.name">
              {{ item.file.name }}
            </div>
            <p class="mt-1 text-11px text-ink-faint">
              {{ item.matchSource === 'name' ? '文件名命中公司全称' : item.matchSource === 'alias' ? '文件名命中公司别名' : '未命中现有分供方' }}
            </p>
          </div>
          <label class="min-w-0">
            <span class="field-label block">分供方</span>
            <select
              class="field-input w-full"
              :value="item.supplierId || '__new__'"
              :aria-label="`${item.file.name} 分供方`"
              @change="updateSupplier(item, ($event.target as HTMLSelectElement).value)"
            >
              <option value="__new__">新分供方（需确认）</option>
              <option v-for="supplier in suppliers" :key="supplier.id" :value="supplier.id">
                {{ supplier.name }}
              </option>
            </select>
            <span v-if="item.supplierId && existingSupplierIds.has(item.supplierId)" class="mt-1 block text-11px text-ok">
              已有项目关系，只追加文件
            </span>
          </label>
          <label>
            <span class="field-label block">文件类别</span>
            <select
              class="field-input w-full"
              :value="item.category"
              :aria-label="`${item.file.name} 文件类别`"
              @change="updateItem(item, { category: ($event.target as HTMLSelectElement).value as ProjectSupplierFileCategory })"
            >
              <option v-for="category in PROJECT_SUPPLIER_FILE_CATEGORIES" :key="category" :value="category">
                {{ category }}
              </option>
            </select>
          </label>
          <div v-if="!item.supplierId" class="col-span-full">
            <label>
              <span class="field-label block">拟新建分供方名称</span>
              <input
                class="field-input w-full"
                :value="item.supplierName"
                :aria-label="`${item.file.name} 新分供方名称`"
                @input="updateItem(item, { supplierName: ($event.target as HTMLInputElement).value, createSupplierConfirmed: false })"
              >
            </label>
            <label class="mt-2 flex items-start gap-2 text-12px text-ink">
              <input
                type="checkbox"
                class="mt-0.5 accent-[var(--brand)]"
                :checked="item.createSupplierConfirmed"
                :aria-label="`确认新建 ${item.supplierName}`"
                @change="updateItem(item, { createSupplierConfirmed: ($event.target as HTMLInputElement).checked })"
              >
              <span>确认把“{{ item.supplierName || '未命名分供方' }}”写入分供方主数据</span>
            </label>
          </div>
        </article>
      </div>
      <p v-if="unresolvedItems.length" class="border-t border-line bg-warn-soft px-4 py-2 text-12px text-warn-ink" role="alert">
        还有 {{ unresolvedItems.length }} 个文件未确认分供方归属。
      </p>
      <div class="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
        <button type="button" class="btn-secondary" @click="stepper.goBackTo('files')">
          上一步
        </button>
        <button type="button" class="btn-accent" :disabled="unresolvedItems.length > 0" @click="goToConfirm">
          下一步：确认生成
        </button>
      </div>
    </section>

    <section v-else class="space-y-3">
      <div class="panel p-4">
        <h2 class="text-14px font-800 text-ink">
          确认生成项目分供方关系
        </h2>
        <p class="mt-1 text-11px text-ink-soft">
          将处理 {{ relationGroups.length }} 家分供方、{{ items.length }} 个文件；已有关系不会重复创建。
        </p>
      </div>
      <div class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))] gap-3">
        <article v-for="group in relationGroups" :key="group.key" class="panel p-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-13px font-800 text-ink">
              {{ group.supplierName }}
            </h3>
            <span v-if="group.createsSupplier" class="chip-warn">新建主数据</span>
            <span v-else-if="group.existing" class="chip-ok">复用已有关系</span>
            <span v-else class="chip-brand">新建项目关系</span>
          </div>
          <ul class="mt-3 space-y-1 text-11px text-ink-soft">
            <li v-for="item in group.items" :key="item.key" class="flex min-w-0 items-center gap-2">
              <span class="chip bg-surface-3 text-ink-soft">{{ item.category }}</span>
              <span class="truncate" :title="item.file.name">{{ item.file.name }}</span>
            </li>
          </ul>
        </article>
      </div>
      <div class="panel flex flex-wrap items-center justify-between gap-2 p-4">
        <button type="button" class="btn-secondary" :disabled="busy" @click="stepper.goBackTo('classify')">
          返回调整
        </button>
        <button type="button" class="btn-accent" :disabled="busy" @click="emit('confirm', items)">
          {{ busy ? '正在保存…' : '确认生成并返回项目' }}
        </button>
      </div>
    </section>
  </div>
</template>
