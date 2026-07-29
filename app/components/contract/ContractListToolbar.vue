<script setup lang="ts">
import { Button } from '~/components/ui/button'

interface ProjectOption {
  key: string
  label: string
}

defineProps<{
  title: string
  loading: boolean
  projectOptions: ProjectOption[]
}>()

const emit = defineEmits<{
  create: []
  refresh: []
}>()

const search = defineModel<string>('search', { required: true })
const project = defineModel<string>('project', { required: true })
</script>

<template>
  <section
    data-ui="contract-list-toolbar"
    aria-label="合同列表工具栏"
    class="contract-list-toolbar panel min-w-0 p-3.5"
  >
    <div class="contract-list-toolbar__layout grid min-w-0 items-center gap-3">
      <div data-ui="contract-list-toolbar-title" class="min-w-0">
        <h2 class="truncate text-14px font-800 text-ink" :title="title">
          {{ title }}
        </h2>
      </div>

      <div class="contract-list-toolbar__project min-w-0">
        <SelectFilter
          v-model="project"
          label="项目"
          :options="projectOptions"
          placeholder="全部项目"
          :min-width="160"
        />
      </div>

      <div
        data-ui="contract-list-toolbar-actions"
        class="contract-list-toolbar__actions min-w-0 flex flex-wrap items-center gap-2.5"
      >
        <SearchInput v-model="search" placeholder="搜索合同名称 / 编号" :width="220" />
        <Button variant="outline" size="icon" title="刷新" :disabled="loading" @click="emit('refresh')">
          <span class="i-lucide-refresh-cw h-3.5 w-3.5" :class="loading ? 'animate-spin' : ''" aria-hidden="true" />
          <span class="sr-only">刷新</span>
        </Button>
        <Button variant="accent" @click="emit('create')">
          <span class="i-lucide-plus h-3.5 w-3.5" aria-hidden="true" />
          新增{{ title }}
        </Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.contract-list-toolbar {
  container-type: inline-size;
}

.contract-list-toolbar__layout {
  grid-template-columns: minmax(0, 1fr);
}

.contract-list-toolbar__project :deep(label) {
  width: 100%;
}

.contract-list-toolbar__project :deep(button) {
  flex: 1 1 auto;
}

.contract-list-toolbar__actions {
  justify-content: flex-start;
}

@container (min-width: 32rem) {
  .contract-list-toolbar__layout {
    grid-template-columns: max-content minmax(12rem, 16rem);
  }

  .contract-list-toolbar__actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}

@container (min-width: 700px) {
  .contract-list-toolbar__layout {
    grid-template-columns: max-content minmax(12rem, 14rem) minmax(0, 1fr);
  }

  .contract-list-toolbar__actions {
    grid-column: auto;
    flex-wrap: nowrap;
    justify-content: flex-end;
  }
}

@container (min-width: 900px) {
  .contract-list-toolbar__layout {
    grid-template-columns: max-content minmax(13rem, 18rem) minmax(0, 1fr);
  }
}
</style>
