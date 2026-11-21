<script setup lang="ts">
import ListRefreshButton from '~/components/shared/ListRefreshButton.vue'
import { Button } from '~/components/ui/button'
import ContextHelp from '~/components/ui/ContextHelp.vue'
import KitMultiSelectFilter from '~/components/ui/KitMultiSelectFilter.vue'
import { enumSelectionFromQuery } from '~/lib/util/enum-selection'

interface FilterOption {
  key: string
  label: string
  count?: number
}

withDefaults(defineProps<{
  title: string
  subtitle: string
  createLabel: string
  loading: boolean
  searchPlaceholder: string
  showType: boolean
  typeLabel: string
  projectOptions: FilterOption[]
  typeOptions: FilterOption[]
  views: FilterOption[]
  canCreate?: boolean
}>(), {
  canCreate: true,
})

const emit = defineEmits<{
  create: []
  refresh: []
}>()

const search = defineModel<string>('search', { required: true })
const project = defineModel<string>('project', { required: true })
const type = defineModel<string | string[]>('type', { required: true })
const view = defineModel<string | string[]>('view', { required: true })
</script>

<template>
  <section
    data-ui="owner-document-list-toolbar"
    :aria-label="`${title}列表工具栏`"
    class="owner-document-toolbar panel min-w-0 p-3.5"
  >
    <div class="owner-document-toolbar__top grid min-w-0 items-center gap-3">
      <div class="min-w-0 flex items-center gap-1.5">
        <h1 class="m-0 truncate text-15px font-800 text-ink" :title="title">
          {{ title }}
        </h1>
        <ContextHelp v-if="subtitle" :label="title" :text="subtitle" />
      </div>

      <div class="owner-document-toolbar__filters flex min-w-0 flex-wrap items-center gap-2.5">
        <SelectFilter
          v-model="project"
          label="项目"
          :options="projectOptions"
          :min-width="156"
        />
        <KitMultiSelectFilter
          v-if="showType"
          :model-value="enumSelectionFromQuery(type)"
          :label="typeLabel"
          :options="typeOptions"
          :min-width="132"
          @update:model-value="type = $event"
        />
        <KitMultiSelectFilter
          :model-value="enumSelectionFromQuery(view)"
          label="状态"
          :options="views"
          :min-width="120"
          @update:model-value="view = $event"
        />
        <SearchInput v-model="search" :placeholder="searchPlaceholder" :width="246" />
        <ListRefreshButton :aria-label="`刷新${title}`" :loading="loading" @refresh="emit('refresh')" />
        <Button v-if="canCreate" variant="accent" @click="emit('create')">
          <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
          {{ createLabel }}
        </Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.owner-document-toolbar {
  container-type: inline-size;
}

.owner-document-toolbar__top {
  grid-template-columns: minmax(0, 1fr);
}

.owner-document-toolbar__filters {
  justify-content: flex-start;
}

@container (min-width: 54rem) {
  .owner-document-toolbar__top {
    grid-template-columns: max-content minmax(0, 1fr);
  }

  .owner-document-toolbar__filters {
    justify-content: flex-end;
  }
}
</style>
