<script setup lang="ts">
import type { ProjectSupplierFileDTO } from '~/lib/project-supplier/repository'
import { computed, shallowRef } from 'vue'
import { formatFileSize } from '~/lib/util/file'
import ProjectSupplierSourceLink from '~/pages/project/[pid]/supplier/_components/ProjectSupplierSourceLink.vue'

const props = defineProps<{
  files: readonly ProjectSupplierFileDTO[]
  returnTo: string
}>()

const expanded = shallowRef(true)
const groups = computed(() => {
  const result = new Map<string, ProjectSupplierFileDTO[]>()
  for (const file of props.files) {
    const key = `${file.ownerType}:${file.ownerId || file.file.id}`
    const current = result.get(key) ?? []
    current.push(file)
    result.set(key, current)
  }
  return [...result.entries()].map(([key, files]) => ({
    key,
    label: files[0]?.sourceLabel || '未标注来源',
    navigation: files[0]?.navigation,
    files,
  }))
})

function dateTime(value: string): string {
  return value ? value.slice(0, 16).replace('T', ' ') : '—'
}
</script>

<template>
  <section class="panel min-w-0 overflow-hidden" aria-labelledby="supplier-workbench-file-title">
    <button
      type="button"
      class="flex w-full items-center gap-2 border-b border-line bg-surface-2 px-3 py-2 text-left"
      :aria-expanded="expanded"
      aria-controls="supplier-workbench-file-content"
      @click="expanded = !expanded"
    >
      <span class="i-lucide-folder-kanban text-14px text-brand" aria-hidden="true" />
      <span id="supplier-workbench-file-title" class="text-13px font-700 text-ink">合作文件</span>
      <span class="chip bg-surface-3 text-ink-soft">{{ files.length }} 份</span>
      <span
        class="ml-auto text-13px text-ink-faint"
        :class="expanded ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        aria-hidden="true"
      />
    </button>

    <div v-if="expanded" id="supplier-workbench-file-content">
      <slot name="toolbar" />
      <div v-if="groups.length === 0" class="bg-surface-2 px-4 py-7 text-center text-12px text-ink-faint">
        暂无来自合同、付款申请、支付或结算的附件
      </div>
      <div v-else class="divide-y divide-line">
        <section v-for="group in groups" :key="group.key">
          <div class="flex items-center gap-2 bg-surface-2 px-3 py-1.5">
            <span class="text-11px font-700 text-ink">{{ group.label }}</span>
            <ProjectSupplierSourceLink v-if="group.navigation" label="查看来源" :intent="group.navigation" :return-to="returnTo" class="ml-auto text-10px" />
          </div>
          <div class="divide-y divide-line">
            <div
              v-for="file in group.files"
              :key="file.file.id"
              class="supplier-file-row grid min-w-0 gap-2 px-3 py-2.5"
            >
              <div class="min-w-0">
                <div class="flex items-center gap-1.5">
                  <slot name="selection" :file="file" />
                  <span class="i-lucide-file-text flex-none text-13px text-ink-faint" aria-hidden="true" />
                  <span class="truncate text-12px font-700 text-ink" :title="file.file.label">
                    {{ file.file.label || '未命名附件' }}
                  </span>
                </div>
                <p class="mt-0.5 pl-5 text-10px text-ink-faint">
                  {{ file.category || '未分类' }} · {{ formatFileSize(file.fileSize) }} ·
                  {{ file.uploader || '未记录上传人' }} · {{ dateTime(file.uploadedAt) }}
                </p>
              </div>
              <div class="flex items-center justify-end text-10px text-ink-faint">
                <slot name="actions" :file="file">
                  中央只读元数据
                </slot>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  </section>
</template>

<style scoped>
.supplier-file-row {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 14rem), 1fr));
}
</style>
