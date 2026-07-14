<script setup lang="ts">
import type {
  ConfiguredExportSettings,
  ConfiguredExportSource,
} from '~/lib/kit/export'
import { computed, useId } from 'vue'
import {
  renderNamePreview,
  resolveTwoLevelFolderPath,
} from '~/lib/kit/export'

interface SelectedFieldRule {
  field: string
  fallback?: string
  takeLast?: number
}

type FieldPosition = 0 | 1
type NamingTextKey = 'separator' | 'extension'

const props = defineProps<{
  source: ConfiguredExportSource
}>()

const settings = defineModel<ConfiguredExportSettings>({ required: true })
const idPrefix = useId()
const fieldIds = {
  firstFolder: `${idPrefix}-first-folder`,
  secondFolder: `${idPrefix}-second-folder`,
  firstName: `${idPrefix}-first-name`,
  secondName: `${idPrefix}-second-name`,
  separator: `${idPrefix}-separator`,
  extension: `${idPrefix}-extension`,
  previewTitle: `${idPrefix}-preview-title`,
} as const

const previewFile = computed(() => props.source.files[0])
const previewPath = computed(() => {
  if (!previewFile.value)
    return '暂无可预览文件'

  const folders = resolveTwoLevelFolderPath(
    settings.value.structure,
    previewFile.value.row,
  )
  const name = renderNamePreview(
    settings.value.naming,
    previewFile.value.row,
  )

  return [...folders, name].join('/')
})

function eventValue(event: Event): string {
  return (event.currentTarget as HTMLInputElement | HTMLSelectElement).value
}

function updateFieldPair(
  current: readonly SelectedFieldRule[],
  position: FieldPosition,
  field: string,
): SelectedFieldRule[] {
  const first = current[0]
  const second = current[1]

  if (position === 0) {
    if (!field)
      return []

    const nextFirst = first?.field === field ? { ...first } : { field }
    return second ? [nextFirst, { ...second }] : [nextFirst]
  }

  if (!first)
    return []

  if (!field)
    return [{ ...first }]

  const nextSecond = second?.field === field ? { ...second } : { field }
  return [{ ...first }, nextSecond]
}

function updateFolderLevel(position: FieldPosition, event: Event) {
  const levels = updateFieldPair(
    settings.value.structure.levels,
    position,
    eventValue(event),
  )

  settings.value = {
    ...settings.value,
    structure: {
      ...settings.value.structure,
      levels,
    },
  }
}

function updateNamingPart(position: FieldPosition, event: Event) {
  const parts = updateFieldPair(
    settings.value.naming.parts,
    position,
    eventValue(event),
  )

  settings.value = {
    ...settings.value,
    naming: {
      ...settings.value.naming,
      parts,
    },
  }
}

function updateNamingText(key: NamingTextKey, event: Event) {
  settings.value = {
    ...settings.value,
    naming: {
      ...settings.value.naming,
      [key]: eventValue(event),
    },
  }
}
</script>

<template>
  <div class="grid gap-4">
    <fieldset class="m-0 min-w-0 border border-line rounded-[var(--radius-card)] bg-panel p-4">
      <legend class="px-1 text-13px text-ink font-700">
        文件夹结构
      </legend>
      <p class="mb-3 text-12px text-ink-faint">
        最多按两个字段分级，导出时会为每条数据生成对应目录。
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="min-w-0 flex flex-col">
          <label :for="fieldIds.firstFolder" class="field-label">
            一级目录字段
          </label>
          <select
            :id="fieldIds.firstFolder"
            :value="settings.structure.levels[0]?.field ?? ''"
            class="field-input w-full"
            @change="updateFolderLevel(0, $event)"
          >
            <option value="">
              不创建分级目录
            </option>
            <option v-for="field in source.fields" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select>
        </div>

        <div class="min-w-0 flex flex-col">
          <label :for="fieldIds.secondFolder" class="field-label">
            二级目录字段
          </label>
          <select
            :id="fieldIds.secondFolder"
            :value="settings.structure.levels[1]?.field ?? ''"
            class="field-input w-full disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60"
            :disabled="!settings.structure.levels[0]"
            @change="updateFolderLevel(1, $event)"
          >
            <option value="">
              不创建二级目录
            </option>
            <option v-for="field in source.fields" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select>
        </div>
      </div>
    </fieldset>

    <fieldset class="m-0 min-w-0 border border-line rounded-[var(--radius-card)] bg-panel p-4">
      <legend class="px-1 text-13px text-ink font-700">
        文件命名规则
      </legend>
      <p class="mb-3 text-12px text-ink-faint">
        按顺序组合最多两段数据，分隔符和扩展名会立即反映到预览。
      </p>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="min-w-0 flex flex-col">
          <label :for="fieldIds.firstName" class="field-label">
            命名字段·第一段
          </label>
          <select
            :id="fieldIds.firstName"
            :value="settings.naming.parts[0]?.field ?? ''"
            class="field-input w-full"
            @change="updateNamingPart(0, $event)"
          >
            <option value="">
              不使用数据字段
            </option>
            <option v-for="field in source.fields" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select>
        </div>

        <div class="min-w-0 flex flex-col">
          <label :for="fieldIds.secondName" class="field-label">
            命名字段·第二段
          </label>
          <select
            :id="fieldIds.secondName"
            :value="settings.naming.parts[1]?.field ?? ''"
            class="field-input w-full disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60"
            :disabled="!settings.naming.parts[0]"
            @change="updateNamingPart(1, $event)"
          >
            <option value="">
              不添加第二段
            </option>
            <option v-for="field in source.fields" :key="field.key" :value="field.key">
              {{ field.label }}
            </option>
          </select>
        </div>

        <div class="min-w-0 flex flex-col">
          <label :for="fieldIds.separator" class="field-label">
            分隔符
          </label>
          <input
            :id="fieldIds.separator"
            :value="settings.naming.separator ?? '-'"
            type="text"
            class="field-input w-full font-mono"
            autocomplete="off"
            spellcheck="false"
            @input="updateNamingText('separator', $event)"
          >
        </div>

        <div class="min-w-0 flex flex-col">
          <label :for="fieldIds.extension" class="field-label">
            扩展名
          </label>
          <input
            :id="fieldIds.extension"
            :value="settings.naming.extension ?? ''"
            type="text"
            class="field-input w-full font-mono"
            placeholder="例如 pdf 或 .pdf"
            autocomplete="off"
            spellcheck="false"
            @input="updateNamingText('extension', $event)"
          >
        </div>
      </div>
    </fieldset>

    <section
      class="border border-brand/25 rounded-[var(--radius-card)] bg-brand-soft p-4"
      :aria-labelledby="fieldIds.previewTitle"
    >
      <div class="mb-2 flex items-center justify-between gap-3">
        <h3 :id="fieldIds.previewTitle" class="text-13px text-brand-deep font-700">
          相对路径预览
        </h3>
        <span class="text-11px text-ink-faint">
          {{ source.label }}
        </span>
      </div>
      <output
        class="block break-all border border-line rounded-[var(--radius-sm)] bg-panel px-3 py-2 font-mono text-13px text-ink"
        aria-live="polite"
      >{{ previewPath }}</output>
    </section>
  </div>
</template>
