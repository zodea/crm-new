<script setup lang="ts">
import type { ProjectSupplierFilesContext } from '~/composables/useProjectSupplierFiles'
import type { ProjectSupplierFileDTO } from '~/lib/project-supplier/read-contract'
import { useProjectSupplierFiles } from '~/composables/useProjectSupplierFiles'

const props = defineProps<{
  files: readonly ProjectSupplierFileDTO[]
  returnTo: string
  context: ProjectSupplierFilesContext | null
}>()
const { $repositories } = useNuxtApp()
const { selectedIds, busy, problem, archiveNotice, allSelected, availability, selectable, canPreview, toggle, toggleAll, preview, download, downloadSelected, cancel } = useProjectSupplierFiles({
  context: () => props.context,
  files: () => props.files,
  repository: $repositories.projectSupplierRead,
})
</script>

<template>
  <ProjectSupplierFilePanel :files="files" :return-to="returnTo">
    <template #toolbar>
      <div class="flex flex-wrap items-center gap-3 border-b border-line px-3 py-2">
        <label class="flex items-center gap-1.5 text-11px text-ink-soft">
          <input type="checkbox" aria-label="全选合作档案原件" :checked="allSelected" :disabled="!!busy || !context" @change="toggleAll">
          全选合作档案
        </label>
        <span class="text-11px text-ink-faint">已选 {{ selectedIds.length }} 份</span>
        <KitButton class="ml-auto h-7 text-11px" :disabled="!selectedIds.length || !!busy || !context" :loading="busy === 'zip'" @click="downloadSelected">
          下载选中 ZIP
        </KitButton>
        <KitButton v-if="busy" class="h-7 text-11px" @click="cancel">
          取消读取
        </KitButton>
      </div>
      <p v-if="problem" role="alert" class="m-0 border-b border-line px-3 py-2 text-12px text-danger">
        {{ problem }}
      </p>
      <p v-if="archiveNotice" role="status" class="m-0 border-b border-line px-3 py-2 text-12px text-ink-soft">
        {{ archiveNotice }}
      </p>
    </template>
    <template #selection="{ file }">
      <input type="checkbox" :aria-label="`选择 ${file.file.label}`" :checked="selectedIds.includes(file.file.id)" :disabled="!!busy || !selectable(file)" @change="toggle(file)">
    </template>
    <template #actions="{ file }">
      <div class="flex flex-wrap items-center justify-end gap-2">
        <span v-if="availability(file)" class="text-10px text-ink-faint">{{ availability(file) }}</span>
        <template v-else>
          <KitButton v-if="canPreview(file)" class="h-7 text-11px" :aria-label="`预览 ${file.file.label}`" :disabled="!!busy" :loading="busy === `preview:${file.file.id}`" @click="preview(file)">
            预览
          </KitButton>
          <KitButton class="h-7 text-11px" :aria-label="`下载 ${file.file.label}`" :disabled="!!busy" :loading="busy === `download:${file.file.id}`" @click="download(file)">
            下载原件
          </KitButton>
        </template>
      </div>
    </template>
  </ProjectSupplierFilePanel>
</template>
