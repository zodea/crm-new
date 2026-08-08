<script setup lang="ts">
import type { ProjectArchiveTreeNode } from '~/lib/project/archive'
import { computed } from 'vue'
import { formatFileSize } from '~/lib/util/file'

const props = withDefaults(defineProps<{
  node: ProjectArchiveTreeNode
  depth?: number
  expandedKeys: ReadonlySet<string>
  selectedKeys: ReadonlySet<string>
}>(), {
  depth: 0,
})

const emit = defineEmits<{
  toggle: [node: ProjectArchiveTreeNode]
  expand: [key: string]
}>()

const isFolder = computed(() => props.node.kind === 'folder')
const isExpanded = computed(() => props.expandedKeys.has(props.node.key))

function leaves(node: ProjectArchiveTreeNode): ProjectArchiveTreeNode[] {
  if (node.kind === 'file')
    return node.file?.hasPayload ? [node] : []
  return (node.children ?? []).flatMap(child => leaves(child))
}

function selectionState(node: ProjectArchiveTreeNode): 'on' | 'off' | 'mixed' {
  if (node.kind === 'file')
    return node.file?.hasPayload && props.selectedKeys.has(node.file.id) ? 'on' : 'off'
  const candidates = leaves(node)
  if (!candidates.length)
    return 'off'
  const selected = candidates.filter(candidate => candidate.file && props.selectedKeys.has(candidate.file.id)).length
  return selected === 0 ? 'off' : selected === candidates.length ? 'on' : 'mixed'
}

function containsSelectedSensitive(node: ProjectArchiveTreeNode): boolean {
  if (node.kind === 'file')
    return node.sensitive === true && !!node.file && props.selectedKeys.has(node.file.id)
  return (node.children ?? []).some(child => containsSelectedSensitive(child))
}

function labelForCheckbox(node: ProjectArchiveTreeNode): string {
  return `${selectionState(node) === 'on' ? '取消' : '勾选'} ${node.label}`
}
</script>

<template>
  <div class="project-archive-tree-node min-w-0">
    <div
      class="flex min-w-0 items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1.5 hover:bg-surface-3"
      :style="{ paddingLeft: `${0.5 + props.depth * 1.1}rem` }"
      :data-node-key="node.key"
    >
      <button
        v-if="isFolder"
        type="button"
        class="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--radius-sm)] text-ink-faint hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand"
        :aria-label="`${isExpanded ? '收起' : '展开'} ${node.label}`"
        :aria-expanded="isExpanded"
        @click="emit('expand', node.key)"
      >
        <span :class="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" aria-hidden="true" />
      </button>
      <span v-else class="h-6 w-6 shrink-0" aria-hidden="true" />

      <button
        type="button"
        role="checkbox"
        class="grid h-5 w-5 shrink-0 place-items-center rounded-[var(--radius-sm)] border text-10px focus-visible:outline-2 focus-visible:outline-brand"
        :class="[
          selectionState(node) === 'on' ? 'border-brand bg-brand text-white' : selectionState(node) === 'mixed' ? 'border-brand bg-brand-soft text-brand' : 'border-line-strong bg-panel text-transparent',
          node.kind === 'file' && !node.file?.hasPayload ? 'cursor-not-allowed opacity-50' : '',
        ]"
        :aria-checked="selectionState(node) === 'mixed' ? 'mixed' : selectionState(node) === 'on'"
        :aria-label="labelForCheckbox(node)"
        :disabled="node.kind === 'file' && !node.file?.hasPayload"
        @click="emit('toggle', node)"
      >
        <span v-if="selectionState(node) === 'on'" class="i-lucide-check" aria-hidden="true" />
        <span v-else-if="selectionState(node) === 'mixed'" class="h-0.5 w-2.5 rounded-full bg-brand" aria-hidden="true" />
      </button>

      <span
        class="shrink-0 text-13px"
        :class="node.kind === 'folder' ? 'i-lucide-folder text-brand' : node.sensitive ? 'i-lucide-shield-alert text-danger' : 'i-lucide-file-text text-ink-faint'"
        aria-hidden="true"
      />
      <span class="min-w-0 flex-1 truncate text-12px" :class="node.kind === 'folder' ? 'font-700 text-ink' : 'text-ink-soft'" :title="node.label">
        {{ node.label }}
      </span>
      <span v-if="node.sensitive" class="chip-warn shrink-0 text-10px">
        敏感
      </span>
      <span v-if="containsSelectedSensitive(node)" class="chip-danger shrink-0 text-10px">
        已选敏感
      </span>
      <span v-if="node.kind === 'file' && !node.file?.hasPayload" class="chip-warn shrink-0 text-10px">
        原件缺失
      </span>
      <span v-if="node.kind === 'folder' && node.empty" class="shrink-0 text-10px text-ink-faint">
        暂无资料
      </span>
      <span v-else-if="node.kind === 'file'" class="shrink-0 text-10px text-ink-faint">
        {{ node.file?.fileSize ? formatFileSize(node.file.fileSize) : '—' }}
      </span>
    </div>

    <div v-if="isFolder && isExpanded" class="min-w-0">
      <ProjectArchiveTreeNode
        v-for="child in node.children"
        :key="child.key"
        :node="child"
        :depth="(props.depth ?? 0) + 1"
        :expanded-keys="expandedKeys"
        :selected-keys="selectedKeys"
        @toggle="emit('toggle', $event)"
        @expand="emit('expand', $event)"
      />
      <p v-if="!node.children?.length" class="m-0 px-3 py-2 text-11px text-ink-faint">
        暂无资料
      </p>
    </div>
  </div>
</template>
