<script setup lang="ts">
import type { ProjectSupplierReferenceDTO } from '~/lib/project/repository'
import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'
import { resolveNavigationTarget } from '~/lib/nav/target-registry'

const props = defineProps<{
  projectId: string
  origin: DataOriginDTO
  access: 'allowed' | 'forbidden' | 'error'
  relationships: readonly ProjectSupplierReferenceDTO[]
  canImport?: boolean
}>()

const relationships = computed(() => props.relationships.map(relationship => ({
  ...relationship,
  target: resolveNavigationTarget(relationship.navigation),
})))
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
      v-if="access === 'error'"
      kind="error"
      title="项目分供方读取失败"
      description="中央关系暂不可用，请刷新项目详情重试。"
      compact
    />
    <StatePanel
      v-else-if="access === 'forbidden'"
      kind="forbidden"
      title="无权查看项目分供方"
      compact
    />
    <div v-else-if="relationships.length" class="divide-y divide-line">
      <NuxtLink
        v-for="relationship in relationships.filter(item => item.target.state === 'resolved')"
        :key="relationship.relationId"
        :to="relationship.target.state === 'resolved' ? relationship.target.to : ''"
        class="flex min-w-0 items-center gap-2 px-3 py-2 text-12px hover:bg-surface-2"
      >
        <span class="i-lucide-building-2 shrink-0 text-brand" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate font-600 text-brand">
          {{ relationship.supplier.state === 'resolved' ? relationship.supplier.label : '分供方身份不可用' }}
        </span>
        <span class="i-lucide-chevron-right shrink-0 text-ink-faint" aria-hidden="true" />
      </NuxtLink>
      <div
        v-for="relationship in relationships.filter(item => item.target.state !== 'resolved')"
        :key="relationship.relationId"
        class="flex min-w-0 items-center gap-2 px-3 py-2 text-12px text-ink-faint"
      >
        <span class="i-lucide-lock-keyhole shrink-0" aria-hidden="true" />
        <span>{{ relationship.supplier.state === 'forbidden' ? '无权查看分供方' : '分供方身份未记录' }}</span>
      </div>
    </div>
    <p v-else class="m-0 px-3 py-4 text-center text-11px text-ink-faint">
      当前项目尚未关联分供方
    </p>

    <div v-if="canImport && origin === 'real'" class="border-t border-line px-3 py-2">
      <NuxtLink
        :to="`/project/${projectId}/supplier/import?origin=real`"
        class="btn-secondary w-full justify-center"
      >
        <span class="i-lucide-file-up mr-1" aria-hidden="true" />
        从文件导入分供方
      </NuxtLink>
    </div>
  </section>
</template>
