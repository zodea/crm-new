<script setup lang="ts">
import type { MaterialPriceCatalogItem } from '~/lib/material/price-analysis'
import { computed, shallowRef, watch } from 'vue'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import SearchInput from '~/components/ui/SearchInput.vue'
import { normalizeMaterialIdentityText } from '~/lib/material/price-analysis'

const props = defineProps<{
  materials: readonly MaterialPriceCatalogItem[]
}>()

const selectedKey = defineModel<string>({ required: true })
const query = shallowRef('')
const selectedCategoryIds = shallowRef<string[]>([])

const categories = computed(() => {
  const byId = new Map(
    props.materials.map(material => [material.category.id, material.category]),
  )
  return [...byId.values()].sort((a, b) =>
    a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'),
  )
})
const categoryOptions = computed(() => categories.value.map(category => ({
  key: category.id,
  label: category.order === 99 ? category.name : `${category.order}. ${category.name}`,
})))

const filteredMaterials = computed(() => {
  const needle = normalizeMaterialIdentityText(query.value)
  return props.materials.filter((material) => {
    const categoryMatched = !selectedCategoryIds.value.length
      || selectedCategoryIds.value.includes(material.category.id)
    const searchMatched = !needle
      || material.searchText.includes(needle)
      || normalizeMaterialIdentityText(material.category.name).includes(needle)
    return categoryMatched && searchMatched
  })
})

watch(filteredMaterials, (materials) => {
  if (!materials.some(material => material.key === selectedKey.value))
    selectedKey.value = materials[0]?.key ?? ''
})
</script>

<template>
  <aside class="material-picker panel" aria-label="材料选择">
    <header class="material-picker__header">
      <div class="flex items-center gap-1.5">
        <h2 class="text-14px font-800 text-ink">
          选择材料
        </h2>
        <ContextHelp label="材料识别" text="名称、规格与单位共同确定同一种材料。" />
      </div>
      <span class="chip-brand">{{ materials.length }} 种</span>
    </header>

    <div class="grid gap-2 border-b border-line p-3">
      <SearchInput
        v-model="query"
        placeholder="搜索材料名称、规格或单位"
        :width="256"
        class="max-w-full [&_input]:max-w-full"
      />
      <KitMultiSelectFilter
        v-model="selectedCategoryIds"
        label="大类"
        aria-label="按官方材料大类筛选"
        :options="categoryOptions"
        full-width
        :min-width="100"
      />
    </div>

    <div
      v-if="filteredMaterials.length"
      role="listbox"
      aria-label="可分析材料"
      class="material-picker__list"
    >
      <button
        v-for="material in filteredMaterials"
        :key="material.key"
        type="button"
        role="option"
        :aria-selected="material.key === selectedKey"
        class="material-picker__option"
        :class="{ 'material-picker__option--selected': material.key === selectedKey }"
        @click="selectedKey = material.key"
      >
        <span class="min-w-0">
          <span class="block truncate text-13px font-700 text-ink">{{ material.name }}</span>
          <span class="mt-0.5 block truncate text-11px text-ink-soft">
            {{ material.spec || '无规格' }} · {{ material.unit }}
          </span>
          <span class="mt-1 block truncate text-10px text-ink-faint">
            {{ material.category.name }}
          </span>
        </span>
        <span class="shrink-0 text-11px text-ink-faint">{{ material.facts.length }} 个价格点</span>
      </button>
    </div>

    <div v-else role="status" class="px-3 py-8 text-center text-12px text-ink-soft">
      没有匹配的材料
    </div>
  </aside>
</template>

<style scoped>
.material-picker {
  min-width: 0;
  overflow: hidden;
}

.material-picker__header {
  display: flex;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-bottom: 1px solid var(--line);
  padding: 10px 12px;
}

.material-picker__list {
  max-height: min(62dvh, 620px);
  overflow-y: auto;
  padding: 4px;
}

.material-picker__option {
  display: flex;
  width: 100%;
  min-height: 54px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-btn);
  background: transparent;
  padding: 8px 9px;
  text-align: left;
  cursor: pointer;
}

.material-picker__option:hover {
  background: var(--surface-2);
}

.material-picker__option:focus-visible {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-ring);
  outline: none;
}

.material-picker__option--selected {
  border-color: var(--brand);
  background: var(--brand-soft);
}
</style>
