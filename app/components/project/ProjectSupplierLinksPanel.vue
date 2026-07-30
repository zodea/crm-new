<script setup lang="ts">
import { computed, onMounted, shallowRef } from 'vue'

const props = defineProps<{
  projectId: string
}>()

const store = useProjectSupplierStore()
const relationships = computed(() => store.byProject(props.projectId))
const loadError = shallowRef('')

async function loadRelationships() {
  loadError.value = ''
  try {
    await store.load()
  }
  catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : '合作关系读取失败'
  }
}

onMounted(() => {
  void loadRelationships()
})
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="project-suppliers-title">
    <SectionHeader>
      <span id="project-suppliers-title">项目分供方</span>
      <template #extra>
        <span class="chip-brand">{{ relationships.length }} 家</span>
      </template>
    </SectionHeader>

    <StatePanel
      v-if="loadError"
      kind="error"
      title="合作关系读取失败"
      :description="loadError"
      action-label="重试"
      compact
      @action="loadRelationships"
    />
    <StatePanel
      v-else-if="store.loading && relationships.length === 0"
      kind="loading"
      title="正在读取合作关系"
      compact
    />
    <div v-else-if="relationships.length" class="divide-y divide-line">
      <NuxtLink
        v-for="relationship in relationships"
        :key="relationship.id"
        :to="`/project/${projectId}/supplier/${relationship.supplierId}`"
        class="flex min-w-0 items-center gap-2 px-3 py-2 text-12px hover:bg-surface-2"
      >
        <span class="i-lucide-building-2 shrink-0 text-brand" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate font-600 text-brand">
          {{ relationship.supplierName || relationship.supplierId }}
        </span>
        <span class="i-lucide-chevron-right shrink-0 text-ink-faint" aria-hidden="true" />
      </NuxtLink>
    </div>
    <p v-else class="m-0 px-3 py-4 text-center text-11px text-ink-faint">
      当前项目尚未关联分供方
    </p>

    <div class="border-t border-line px-3 py-2">
      <NuxtLink
        :to="`/project/${projectId}/supplier/import`"
        class="btn-secondary w-full justify-center"
      >
        <span class="i-lucide-file-up mr-1" aria-hidden="true" />
        从文件导入分供方
      </NuxtLink>
    </div>
  </section>
</template>
