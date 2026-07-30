<script setup lang="ts">
import { Button } from '~/components/ui/button'

interface ProjectOption {
  key: string
  label: string
}

defineProps<{
  loading: boolean
  projectOptions: ProjectOption[]
  search: string
  project: string
}>()

const emit = defineEmits<{
  'refresh': []
  'openRecords': []
  'update:search': [value: string]
  'update:project': [value: string]
}>()
</script>

<template>
  <section
    aria-label="付款管理工具栏"
    data-ui="payment-management-toolbar"
    class="payment-management-toolbar panel min-w-0 p-3.5"
  >
    <div class="payment-management-toolbar__layout grid min-w-0 items-center gap-3">
      <div class="min-w-0">
        <h1 class="text-17px font-800 text-ink">
          付款管理
        </h1>
        <p class="mt-0.5 text-11px text-ink-faint">
          待支付工作台 · 批复金额与银行实际支付分开核对
        </p>
      </div>

      <div class="payment-management-toolbar__project min-w-0">
        <SelectFilter
          :model-value="project"
          label="项目"
          :options="projectOptions"
          placeholder="全部项目"
          :min-width="160"
          @update:model-value="emit('update:project', $event ?? 'all')"
        />
      </div>

      <div class="payment-management-toolbar__actions min-w-0 flex flex-wrap items-center gap-2.5">
        <SearchInput
          :model-value="search"
          placeholder="搜索申请名称、编号或收款单位"
          :width="240"
          @update:model-value="emit('update:search', $event ?? '')"
        />
        <Button
          variant="outline"
          size="icon"
          title="刷新"
          :disabled="loading"
          @click="emit('refresh')"
        >
          <span
            class="i-lucide-refresh-cw h-3.5 w-3.5"
            :class="loading ? 'animate-spin' : ''"
            aria-hidden="true"
          />
          <span class="sr-only">刷新付款管理</span>
        </Button>
        <Button variant="accent" @click="emit('openRecords')">
          <span class="i-lucide-list-checks h-3.5 w-3.5" aria-hidden="true" />
          支付记录
        </Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.payment-management-toolbar {
  container-type: inline-size;
}

.payment-management-toolbar__layout {
  grid-template-columns: minmax(0, 1fr);
}

.payment-management-toolbar__project :deep(label) {
  width: 100%;
}

.payment-management-toolbar__project :deep(button) {
  flex: 1 1 auto;
}

.payment-management-toolbar__actions {
  justify-content: flex-start;
}

@container (min-width: 34rem) {
  .payment-management-toolbar__layout {
    grid-template-columns: minmax(12rem, 1fr) minmax(12rem, 16rem);
  }

  .payment-management-toolbar__actions {
    grid-column: 1 / -1;
    justify-content: flex-end;
  }
}

@container (min-width: 58rem) {
  .payment-management-toolbar__layout {
    grid-template-columns: minmax(17rem, 1fr) minmax(12rem, 16rem) minmax(0, 1fr);
  }

  .payment-management-toolbar__actions {
    grid-column: auto;
    flex-wrap: nowrap;
    justify-content: flex-end;
  }
}
</style>
