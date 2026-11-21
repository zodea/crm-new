<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import {
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  PopoverContent,
  PopoverPortal,
  PopoverRoot,
  PopoverTrigger,
} from 'reka-ui'
import ProjectSwitcherPanel from '~/components/project/ProjectSwitcherPanel.vue'
import { useModalLayerRegistration, useOwnedOverlayLayerStyle } from '~/composables/useOverlayStack'

interface ProjectOption {
  id: string
  name: string
  code?: string
  status?: string
}

const props = withDefaults(defineProps<{
  projects: readonly ProjectOption[]
  loading?: boolean
  error?: string
  disabled?: boolean
  ariaLabel?: string
}>(), {
  loading: false,
  error: '',
  disabled: false,
  ariaLabel: '选择项目',
})

const model = defineModel<string>({ required: true })

const open = shallowRef(false)
const panelId = `project-switcher-${useId()}`
const isCompact = useMediaQuery('(max-width: 768px)', { ssrWidth: 1024 })
const { layerStyle: modalLayerStyle } = useModalLayerRegistration(computed(() => isCompact.value && open.value))
const ownedLayerStyle = useOwnedOverlayLayerStyle()

const currentProject = computed(() => props.projects.find(project => project.id === model.value) ?? null)

function statusClass(status = ''): string {
  if (status.includes('竣工') || status.includes('结算'))
    return 'is-finished'
  if (status.includes('停工'))
    return 'is-stopped'
  if (status.includes('筹备'))
    return 'is-preparing'
  return 'is-active'
}

function openFromKeyboard(event: KeyboardEvent) {
  if (event.key !== 'ArrowDown')
    return
  event.preventDefault()
  open.value = true
}

function selectProject(projectId: string) {
  model.value = projectId
  open.value = false
}
</script>

<template>
  <div class="project-switcher-root min-w-0">
    <PopoverRoot v-if="!isCompact" v-model:open="open">
      <PopoverTrigger as-child>
        <button
          type="button"
          class="project-switcher-trigger"
          :disabled="disabled"
          :aria-label="ariaLabel"
          data-testid="project-switcher-trigger"
          @keydown="openFromKeyboard"
        >
          <span class="i-lucide-building-2 h-4 w-4 flex-none text-brand" aria-hidden="true" />
          <span v-if="currentProject" class="min-w-0 flex-1">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="project-status-dot" :class="statusClass(currentProject.status)" aria-hidden="true" />
              <span class="truncate text-12px font-750 text-ink">{{ currentProject.name }}</span>
            </span>
            <span v-if="currentProject.code" class="mt-0.5 block truncate text-10px text-ink-faint">{{ currentProject.code }}</span>
          </span>
          <span v-else class="min-w-0 flex-1 truncate text-left text-12px text-ink-soft">
            {{ loading ? '正在加载项目…' : '选择项目' }}
          </span>
          <span class="i-lucide-chevrons-up-down h-3.5 w-3.5 flex-none text-ink-faint" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverPortal>
        <PopoverContent
          :id="panelId"
          align="start"
          :side-offset="6"
          :collision-padding="12"
          data-overlay-owned
          class="overlay-layer-owned w-[min(360px,calc(100vw-24px))] overflow-hidden border border-line rounded-[var(--radius-card)] bg-panel text-ink shadow-[var(--shadow-pop)] outline-none"
          :style="ownedLayerStyle"
        >
          <ProjectSwitcherPanel
            :projects="projects"
            :selected-id="model"
            :loading="loading"
            :error="error"
            :panel-id="panelId"
            @select="selectProject"
            @close="open = false"
          />
        </PopoverContent>
      </PopoverPortal>
    </PopoverRoot>

    <DialogRoot v-else v-model:open="open">
      <DialogTrigger as-child>
        <button
          type="button"
          class="project-switcher-trigger"
          :disabled="disabled"
          :aria-label="ariaLabel"
          data-testid="project-switcher-trigger"
          @keydown="openFromKeyboard"
        >
          <span class="i-lucide-building-2 h-4 w-4 flex-none text-brand" aria-hidden="true" />
          <span v-if="currentProject" class="min-w-0 flex-1">
            <span class="flex min-w-0 items-center gap-1.5">
              <span class="project-status-dot" :class="statusClass(currentProject.status)" aria-hidden="true" />
              <span class="truncate text-12px font-750 text-ink">{{ currentProject.name }}</span>
            </span>
            <span v-if="currentProject.code" class="mt-0.5 block truncate text-10px text-ink-faint">{{ currentProject.code }}</span>
          </span>
          <span v-else class="min-w-0 flex-1 truncate text-left text-12px text-ink-soft">
            {{ loading ? '正在加载项目…' : '选择项目' }}
          </span>
          <span class="i-lucide-chevrons-up-down h-3.5 w-3.5 flex-none text-ink-faint" aria-hidden="true" />
        </button>
      </DialogTrigger>
      <DialogPortal>
        <DialogOverlay
          data-overlay-backdrop
          class="overlay-layer-backdrop fixed inset-0 bg-[var(--overlay)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
          :style="modalLayerStyle"
        />
        <DialogContent
          :id="panelId"
          data-overlay-surface
          class="overlay-layer-surface fixed inset-0 flex h-svh w-screen flex-col bg-panel text-ink outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
          :style="modalLayerStyle"
        >
          <header class="flex min-h-13 flex-none items-center gap-3 border-b border-line px-3">
            <button
              type="button"
              class="shell-icon-button"
              aria-label="关闭项目选择"
              @click="open = false"
            >
              <span class="i-lucide-arrow-left h-4 w-4" aria-hidden="true" />
            </button>
            <div class="min-w-0 flex-1">
              <DialogTitle class="text-14px font-800 text-ink">
                选择项目
              </DialogTitle>
              <DialogDescription class="text-10px text-ink-faint">
                搜索并切换当前工作项目
              </DialogDescription>
            </div>
          </header>
          <ProjectSwitcherPanel
            class="min-h-0 flex-1"
            :projects="projects"
            :selected-id="model"
            :loading="loading"
            :error="error"
            :panel-id="panelId"
            @select="selectProject"
            @close="open = false"
          />
        </DialogContent>
      </DialogPortal>
    </DialogRoot>
  </div>
</template>

<style scoped>
.project-switcher-trigger { display: flex; width: 100%; min-height: 42px; min-width: 0; align-items: center; gap: 8px; border: 1px solid var(--line-strong); border-radius: var(--radius-btn); background: var(--panel); padding: 5px 9px; text-align: left; transition: border-color var(--dur-fast), box-shadow var(--dur-fast), background-color var(--dur-fast); }
.project-switcher-trigger:hover { border-color: var(--brand); background: var(--brand-soft); }
.project-switcher-trigger:focus-visible { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-ring); outline: none; }
.project-switcher-trigger:disabled { cursor: not-allowed; opacity: .55; }
.project-status-dot { width: 7px; height: 7px; flex: none; border-radius: 999px; background: var(--ink-faint); }
.project-status-dot.is-active { background: var(--ok); }
.project-status-dot.is-preparing { background: var(--warn); }
.project-status-dot.is-stopped { background: var(--danger); }
.project-status-dot.is-finished { background: var(--ink-faint); }
</style>
