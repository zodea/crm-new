<script setup lang="ts">
import { Button } from '~/components/ui/button'

interface FilterOption {
  key: string
  label: string
}

defineProps<{
  title: string
  subtitle: string
  createLabel: string
  loading: boolean
  searchPlaceholder: string
  showProject: boolean
  showCategory: boolean
  projectOptions: FilterOption[]
  categoryOptions: FilterOption[]
  statusOptions: FilterOption[]
}>()

const emit = defineEmits<{
  create: []
  refresh: []
}>()

const search = defineModel<string>('search', { required: true })
const project = defineModel<string>('project', { required: true })
const category = defineModel<string>('category', { required: true })
const status = defineModel<string>('status', { required: true })
</script>

<template>
  <section
    data-ui="contract-aux-list-toolbar"
    :aria-label="`${title}列表工具栏`"
    class="aux-toolbar panel min-w-0 p-3.5"
  >
    <div class="aux-toolbar__layout grid min-w-0 items-center gap-3">
      <div class="min-w-0">
        <h1 class="m-0 truncate text-15px font-800 text-ink" :title="title">
          {{ title }}
        </h1>
        <p class="m-0 mt-0.5 truncate text-11px text-ink-faint" :title="subtitle">
          {{ subtitle }}
        </p>
      </div>

      <div v-if="showProject" class="aux-toolbar__filter min-w-0">
        <SelectFilter
          v-model="project"
          label="项目"
          :options="projectOptions"
          :min-width="156"
          full-width
        />
      </div>
      <div v-if="showCategory" class="aux-toolbar__filter min-w-0">
        <SelectFilter
          v-model="category"
          label="类别"
          :options="categoryOptions"
          :min-width="132"
          full-width
        />
      </div>

      <div class="aux-toolbar__actions min-w-0 flex flex-wrap items-center gap-2.5">
        <SelectFilter
          v-model="status"
          label="状态"
          :options="statusOptions"
          :min-width="112"
        />
        <SearchInput v-model="search" :placeholder="searchPlaceholder" :width="236" />
        <Button
          variant="outline"
          size="icon"
          title="刷新"
          :aria-label="`刷新${title}`"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <span
            class="i-lucide-refresh-cw h-3.5 w-3.5"
            :class="loading ? 'animate-spin' : ''"
            aria-hidden="true"
          />
        </Button>
        <Button variant="accent" @click="emit('create')">
          <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
          {{ createLabel }}
        </Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.aux-toolbar {
  container-type: inline-size;
}

.aux-toolbar__layout {
  grid-template-columns: minmax(0, 1fr);
}

.aux-toolbar__actions {
  justify-content: flex-start;
}

@container (min-width: 32rem) {
  .aux-toolbar__layout {
    grid-template-columns: max-content minmax(12rem, 1fr);
  }

  .aux-toolbar__filter {
    grid-column: auto;
  }

  .aux-toolbar__actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}

@container (min-width: 62rem) {
  .aux-toolbar__layout {
    grid-template-columns: max-content repeat(2, minmax(10rem, 14rem)) minmax(0, 1fr);
  }

  .aux-toolbar__actions {
    grid-column: auto;
    flex-wrap: nowrap;
  }
}
</style>
