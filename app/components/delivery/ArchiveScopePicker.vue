<script setup lang="ts">
import type { TreeNode } from '~/lib/kit/tree-nav'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from 'reka-ui'
import { resolveNodeCount } from '~/lib/kit/tree-nav'

const props = defineProps<{
  items: readonly TreeNode[]
}>()

const selectedKey = defineModel<string>({ required: true })
const open = shallowRef(false)
const activeProjectKey = shallowRef<string | null>(null)
useModalLayerRegistration(open)

const allNode = computed(() => props.items.find(item => item.key === 'all'))
const projectNodes = computed(() => props.items.filter(item => item.key !== 'all'))
const activeProject = computed(() =>
  projectNodes.value.find(item => item.key === activeProjectKey.value),
)

const selectedLabel = computed(() => {
  for (const item of props.items) {
    if (item.key === selectedKey.value)
      return item.label
    const child = item.children?.find(candidate => candidate.key === selectedKey.value)
    if (child)
      return `${item.label} · ${child.label}`
  }
  return allNode.value?.label ?? '选择归档范围'
})

function prepareProjectList() {
  activeProjectKey.value = null
}

function openProject(node: TreeNode) {
  if (!node.children?.length) {
    select(node.key)
    return
  }
  activeProjectKey.value = node.key
}

function select(key: string) {
  selectedKey.value = key
  open.value = false
}
</script>

<template>
  <div class="archive-scope-picker">
    <DialogRoot v-model:open="open">
      <DialogTrigger as-child>
        <button
          type="button"
          class="btn-secondary flex w-full min-w-0 justify-start text-left"
          aria-label="选择归档范围"
          @click="prepareProjectList"
        >
          <span class="i-lucide-folders mr-2 shrink-0 text-13px" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate" :title="selectedLabel">{{ selectedLabel }}</span>
          <span class="i-lucide-chevron-right ml-2 shrink-0 text-13px" aria-hidden="true" />
        </button>
      </DialogTrigger>

      <DialogPortal>
        <DialogOverlay
          data-overlay-backdrop
          class="fixed inset-0 z-[var(--z-overlay-backdrop)] bg-[var(--overlay)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"
        />
        <DialogContent
          data-testid="archive-scope-sheet"
          data-overlay-surface
          class="fixed inset-y-0 right-0 z-[var(--z-overlay-surface)] flex h-svh w-[min(360px,calc(100vw-24px))] flex-col border-l border-line bg-panel text-ink shadow-[var(--shadow-pop)] outline-none data-[state=open]:animate-in data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right"
        >
          <header class="flex h-16 shrink-0 items-center gap-2 border-b border-line px-4">
            <button
              v-if="activeProject"
              type="button"
              class="icon-btn shrink-0"
              aria-label="返回项目列表"
              @click="activeProjectKey = null"
            >
              <span class="i-lucide-arrow-left text-13px" aria-hidden="true" />
            </button>
            <div class="min-w-0 flex-1">
              <DialogTitle
                class="truncate text-15px font-800"
                :title="activeProject?.label ?? '选择项目'"
              >
                {{ activeProject?.label ?? '选择项目' }}
              </DialogTitle>
              <DialogDescription class="mt-0.5 text-11px text-ink-soft">
                {{ activeProject ? '选择分供方' : '一次只显示一层' }}
              </DialogDescription>
            </div>
            <button type="button" class="icon-btn shrink-0" aria-label="关闭归档范围" @click="open = false">
              <span class="i-lucide-x text-13px" aria-hidden="true" />
            </button>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <template v-if="!activeProject">
              <button
                v-if="allNode"
                type="button"
                class="archive-scope-picker__row"
                :class="selectedKey === allNode.key ? 'bg-brand-soft text-brand-deep' : 'hover:bg-surface-3'"
                :aria-pressed="selectedKey === allNode.key"
                @click="select(allNode.key)"
              >
                <span class="i-lucide-archive shrink-0 text-14px text-brand" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate" :title="allNode.label">{{ allNode.label }}</span>
                <span v-if="resolveNodeCount(allNode) != null" class="chip bg-surface-3 text-ink-soft">
                  {{ resolveNodeCount(allNode) }}
                </span>
              </button>

              <button
                v-for="project in projectNodes"
                :key="project.key"
                type="button"
                class="archive-scope-picker__row hover:bg-surface-3"
                @click="openProject(project)"
              >
                <span class="i-lucide-building-2 shrink-0 text-14px text-ink-faint" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate" :title="project.label">{{ project.label }}</span>
                <span v-if="resolveNodeCount(project) != null" class="chip bg-surface-3 text-ink-soft">
                  {{ resolveNodeCount(project) }}
                </span>
                <span class="i-lucide-chevron-right shrink-0 text-13px text-ink-faint" aria-hidden="true" />
              </button>
            </template>

            <template v-else>
              <button
                type="button"
                class="archive-scope-picker__row"
                :class="selectedKey === activeProject.key ? 'bg-brand-soft text-brand-deep' : 'hover:bg-surface-3'"
                :aria-pressed="selectedKey === activeProject.key"
                @click="select(activeProject.key)"
              >
                <span class="i-lucide-users shrink-0 text-14px text-brand" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate" title="全部分供方">全部分供方</span>
                <span v-if="resolveNodeCount(activeProject) != null" class="chip bg-surface-3 text-ink-soft">
                  {{ resolveNodeCount(activeProject) }}
                </span>
              </button>

              <button
                v-for="supplier in activeProject.children"
                :key="supplier.key"
                type="button"
                class="archive-scope-picker__row"
                :class="selectedKey === supplier.key ? 'bg-brand-soft text-brand-deep' : 'hover:bg-surface-3'"
                :aria-pressed="selectedKey === supplier.key"
                @click="select(supplier.key)"
              >
                <span
                  class="shrink-0 text-14px"
                  :class="[supplier.icon ?? 'i-lucide-factory', supplier.tone === 'warn' ? 'text-warn' : 'text-ink-faint']"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1 truncate" :title="supplier.label">{{ supplier.label }}</span>
                <span v-if="resolveNodeCount(supplier) != null" class="chip bg-surface-3 text-ink-soft">
                  {{ resolveNodeCount(supplier) }}
                </span>
              </button>
            </template>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>

<style scoped>
.archive-scope-picker__row {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 0.5rem;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: var(--radius-btn);
  background-color: transparent;
  padding: 0.75rem 0.625rem;
  color: var(--ink);
  text-align: left;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
</style>
