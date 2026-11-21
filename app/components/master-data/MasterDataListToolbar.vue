<script setup lang="ts">
import type {
  MasterDataFilterOption,
  MasterDataFilterValue,
  MasterDataListFilterDefinition,
  MasterDataListFilterField,
  MasterDataListSort,
} from '~/lib/master-data/list'
import ListRefreshButton from '~/components/shared/ListRefreshButton.vue'
import { Button } from '~/components/ui/button'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { masterDataSelectedValues } from '~/lib/master-data/list'

defineProps<{
  entityLabel: string
  listLabel: string
  loading: boolean
  filterDefinitions: MasterDataListFilterDefinition[]
  filterOptions: Partial<Record<MasterDataListFilterField, MasterDataFilterOption[]>>
  searchPlaceholder: string
  sortOptions: MasterDataFilterOption[]
  total: number
  visible: number
}>()

const emit = defineEmits<{
  create: []
  refresh: []
}>()

const search = defineModel<string>('search', { required: true })
const filters = defineModel<Partial<Record<MasterDataListFilterField, MasterDataFilterValue>>>('filters', { required: true })
const sort = defineModel<MasterDataListSort>('sort', { required: true })

function setFilter(field: MasterDataListFilterField, value: string[]) {
  filters.value = {
    ...filters.value,
    [field]: value,
  }
}
</script>

<template>
  <section
    data-ui="master-data-list-toolbar"
    class="min-w-0 max-w-full flex-1"
  >
    <div
      data-ui="master-data-list-toolbar-row"
      class="flex min-w-0 flex-nowrap items-center gap-2"
    >
      <div class="mr-1 flex flex-none items-baseline gap-2">
        <h1 class="m-0 text-14px font-800 text-ink">
          {{ listLabel }}
        </h1>
        <span class="whitespace-nowrap text-12px text-ink-soft">
          共 <b class="font-mono text-ink">{{ total }}</b> 条
          <template v-if="visible !== total">· 当前 {{ visible }} 条</template>
        </span>
      </div>

      <div
        data-ui="master-data-list-toolbar-scroll"
        class="min-w-0 flex-1 overflow-x-auto"
      >
        <div class="flex min-w-max flex-nowrap items-center gap-2 pr-1">
          <SearchInput
            v-model="search"
            :placeholder="searchPlaceholder"
            :width="250"
          />
          <ListRefreshButton :loading="loading" @refresh="emit('refresh')" />
          <SelectFilter
            v-model="sort"
            label="排序"
            :options="sortOptions"
            :min-width="132"
          />
          <KitMultiSelectFilter
            v-for="definition in filterDefinitions"
            :key="definition.field"
            :model-value="masterDataSelectedValues(filters[definition.field])"
            :label="definition.label"
            :options="filterOptions[definition.field] || []"
            :min-width="definition.field === 'projectNames' || definition.field === 'projectName' ? 160 : 132"
            @update:model-value="setFilter(definition.field, $event)"
          />
        </div>
      </div>

      <Button class="flex-none" variant="accent" @click="emit('create')">
        <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
        新建{{ entityLabel }}
      </Button>
    </div>
  </section>
</template>
