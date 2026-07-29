<script setup lang="ts">
interface ProjectOption {
  id: string
  name: string
  code?: string
  status?: string
}

const props = withDefaults(defineProps<{
  projects: readonly ProjectOption[]
  selectedId: string
  loading?: boolean
  error?: string
  panelId: string
}>(), {
  loading: false,
  error: '',
})

const emit = defineEmits<{
  close: []
  select: [projectId: string]
}>()

const query = shallowRef('')
const activeProjectId = shallowRef(props.selectedId)
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')

const normalizedQuery = computed(() => query.value.trim().toLocaleLowerCase('zh-CN'))
const filteredProjects = computed(() => {
  if (!normalizedQuery.value)
    return props.projects
  return props.projects.filter((project) => {
    const searchable = `${project.name} ${project.code ?? ''} ${project.status ?? ''}`.toLocaleLowerCase('zh-CN')
    return searchable.includes(normalizedQuery.value)
  })
})
watch(filteredProjects, (projects) => {
  if (!projects.some(project => project.id === activeProjectId.value))
    activeProjectId.value = projects[0]?.id ?? ''
}, { immediate: true })

onMounted(() => {
  nextTick(() => searchInput.value?.focus())
})

function statusClass(status = ''): string {
  if (status.includes('竣工') || status.includes('结算'))
    return 'is-finished'
  if (status.includes('停工'))
    return 'is-stopped'
  if (status.includes('筹备'))
    return 'is-preparing'
  return 'is-active'
}

function optionId(projectId: string): string {
  return `${props.panelId}-option-${projectId}`
}

function moveActive(offset: number) {
  const projects = filteredProjects.value
  if (!projects.length)
    return
  const currentIndex = projects.findIndex(project => project.id === activeProjectId.value)
  const nextIndex = currentIndex < 0
    ? 0
    : (currentIndex + offset + projects.length) % projects.length
  activeProjectId.value = projects[nextIndex]!.id
}

function selectProject(projectId: string) {
  emit('select', projectId)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)
  }
  else if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)
  }
  else if (event.key === 'Enter' && activeProjectId.value) {
    event.preventDefault()
    selectProject(activeProjectId.value)
  }
  else if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
}
</script>

<template>
  <div class="project-switcher-panel flex min-h-0 flex-col" @keydown="handleKeydown">
    <label class="project-search">
      <span class="i-lucide-search h-4 w-4 flex-none text-ink-faint" aria-hidden="true" />
      <input
        ref="searchInput"
        v-model="query"
        type="search"
        autocomplete="off"
        placeholder="搜索项目名称或编码"
        aria-label="搜索项目"
        role="combobox"
        aria-autocomplete="list"
        :aria-controls="`${panelId}-all`"
        :aria-activedescendant="activeProjectId ? optionId(activeProjectId) : undefined"
      >
    </label>

    <p class="sr-only" aria-live="polite">
      {{ loading ? '正在加载项目' : `找到 ${filteredProjects.length} 个项目` }}
    </p>

    <div v-if="loading" class="grid gap-2 p-3" role="status" aria-label="正在加载项目">
      <div v-for="index in 4" :key="index" class="h-9 animate-pulse rounded bg-surface-2" />
    </div>
    <div v-else-if="error" class="grid min-h-32 place-items-center px-5 py-8 text-center" role="alert">
      <div>
        <span class="i-lucide-circle-alert text-20px text-danger" aria-hidden="true" />
        <p class="mt-2 text-12px text-danger">
          {{ error }}
        </p>
      </div>
    </div>
    <div v-else-if="!filteredProjects.length" class="grid min-h-32 place-items-center px-5 py-8 text-center">
      <div>
        <span class="i-lucide-building-2 text-20px text-ink-faint" aria-hidden="true" />
        <p class="mt-2 text-12px font-600 text-ink-soft">
          {{ query ? '没有匹配的项目' : '暂无可查看项目' }}
        </p>
      </div>
    </div>
    <div
      v-else
      :id="`${panelId}-all`"
      role="listbox"
      aria-label="全部项目"
      class="min-h-0 overflow-y-auto overscroll-contain p-2"
    >
      <button
        v-for="project in filteredProjects"
        :id="optionId(project.id)"
        :key="project.id"
        type="button"
        role="option"
        class="project-option"
        :class="activeProjectId === project.id && 'is-active'"
        :aria-selected="selectedId === project.id"
        @pointermove="activeProjectId = project.id"
        @click="selectProject(project.id)"
      >
        <span class="project-status-dot" :class="statusClass(project.status)" aria-hidden="true" />
        <span class="min-w-0 flex-1">
          <span class="block truncate text-12px font-700 text-ink">{{ project.name }}</span>
          <span v-if="project.code || project.status" class="mt-0.5 block truncate text-10px text-ink-faint">
            {{ [project.code, project.status].filter(Boolean).join(' · ') }}
          </span>
        </span>
        <span v-if="selectedId === project.id" class="i-lucide-check h-4 w-4 flex-none text-brand" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.project-switcher-panel { max-height: min(520px, calc(100svh - 32px)); }
.project-search { display: flex; min-height: 42px; flex: none; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); padding: 6px 10px; }
.project-search input { min-width: 0; flex: 1; border: 0; background: transparent; color: var(--ink); font-size: 12px; outline: none; }
.project-search input::placeholder { color: var(--ink-faint); }
.project-option { display: flex; width: 100%; min-width: 0; min-height: 44px; cursor: pointer; align-items: center; gap: 9px; border: 0; border-radius: var(--radius-btn); background: transparent; padding: 7px 8px; font: inherit; text-align: left; transition: background-color var(--dur-fast), box-shadow var(--dur-fast), color var(--dur-fast); }
.project-option:hover, .project-option.is-active { background: var(--brand-soft); }
.project-option[aria-selected='true'] { box-shadow: inset 2px 0 0 var(--brand); }
.project-option:focus-visible { outline: 2px solid var(--brand-ring); outline-offset: -2px; }
.project-status-dot { width: 8px; height: 8px; flex: none; border-radius: 999px; background: var(--ink-faint); }
.project-status-dot.is-active { background: var(--ok); }
.project-status-dot.is-preparing { background: var(--warn); }
.project-status-dot.is-stopped { background: var(--danger); }
.project-status-dot.is-finished { background: var(--ink-faint); }
</style>
