<script setup lang="ts">
import type { ProjectArchiveSnapshot, ProjectArchiveTreeNode } from '~/lib/project/archive'
import { computed, shallowRef, watch } from 'vue'
import { createProjectArchiveZip, loadProjectArchiveSnapshot, sanitizeSegment } from '~/lib/project/archive'

const props = defineProps<{
  projectId: string
}>()

const open = defineModel<boolean>('open', { required: true })
const { error, exportFile, warning } = useKitUI()

const snapshot = shallowRef<ProjectArchiveSnapshot | null>(null)
const loading = shallowRef(false)
const loadError = shallowRef('')
const exporting = shallowRef(false)
const query = shallowRef('')
const selectedKeys = shallowRef(new Set<string>())
const expandedKeys = shallowRef(new Set<string>())

function folderKeys(nodes: readonly ProjectArchiveTreeNode[]): string[] {
  return nodes.flatMap(node => node.kind === 'folder'
    ? [node.key, ...folderKeys(node.children ?? [])]
    : [])
}

function selectableFiles(node: ProjectArchiveTreeNode): ProjectArchiveTreeNode[] {
  if (node.kind === 'file')
    return node.file?.hasPayload && node.file.sensitivity === 'normal' ? [node] : []
  return (node.children ?? []).flatMap(child => selectableFiles(child))
}

function matchesQuery(node: ProjectArchiveTreeNode, needle: string): ProjectArchiveTreeNode | null {
  if (!needle)
    return node
  const children = node.kind === 'folder'
    ? (node.children ?? []).map(child => matchesQuery(child, needle)).filter((child): child is ProjectArchiveTreeNode => !!child)
    : []
  if (node.label.toLocaleLowerCase().includes(needle) || children.length)
    return node.kind === 'folder' ? { ...node, children } : node
  return null
}

const visibleTree = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase()
  return (snapshot.value?.tree ?? [])
    .map(node => matchesQuery(node, needle))
    .filter((node): node is ProjectArchiveTreeNode => !!node)
})

const selectedFiles = computed(() => snapshot.value?.files.filter(file => selectedKeys.value.has(file.id) && file.hasPayload && file.sensitivity === 'normal') ?? [])
const defaultSelectedCount = computed(() => snapshot.value?.files.filter(file => file.sensitivity === 'normal' && file.hasPayload).length ?? 0)

function resetSelection(next: ProjectArchiveSnapshot) {
  selectedKeys.value = new Set(next.files
    .filter(file => file.sensitivity === 'normal' && file.hasPayload)
    .map(file => file.id))
  expandedKeys.value = new Set(folderKeys(next.tree))
}

async function loadSnapshot() {
  loading.value = true
  loadError.value = ''
  try {
    const next = await loadProjectArchiveSnapshot(props.projectId)
    snapshot.value = next
    resetSelection(next)
  }
  catch (cause) {
    loadError.value = cause instanceof Error ? cause.message : '项目档案目录读取失败'
    snapshot.value = null
  }
  finally {
    loading.value = false
  }
}

function selectionState(node: ProjectArchiveTreeNode): 'on' | 'off' | 'mixed' {
  const files = selectableFiles(node)
  if (!files.length)
    return 'off'
  const selected = files.filter(file => file.file && selectedKeys.value.has(file.file.id)).length
  return selected === 0 ? 'off' : selected === files.length ? 'on' : 'mixed'
}

function replaceSelection(next: Set<string>) {
  selectedKeys.value = next
}

async function toggleFile(node: ProjectArchiveTreeNode) {
  const file = node.file
  if (!file || !file.hasPayload) {
    warning('该附件只有元数据，原件正文未保存，不能加入 ZIP')
    return
  }
  if (file.sensitivity === 'sensitive') {
    warning('该证照可在系统中查看，原件导出下载权限待后续配置')
    return
  }
  const next = new Set(selectedKeys.value)
  if (next.has(file.id)) {
    next.delete(file.id)
    replaceSelection(next)
    return
  }
  next.add(file.id)
  replaceSelection(next)
}

async function toggleNode(node: ProjectArchiveTreeNode) {
  if (node.kind === 'file') {
    await toggleFile(node)
    return
  }
  const files = selectableFiles(node)
  if (!files.length) {
    warning('该目录暂无可导出的原件')
    return
  }
  const next = new Set(selectedKeys.value)
  const shouldSelect = selectionState(node) !== 'on'
  for (const candidate of files) {
    const file = candidate.file!
    if (shouldSelect)
      next.add(file.id)
    else
      next.delete(file.id)
  }
  replaceSelection(next)
}

function toggleExpanded(key: string) {
  const next = new Set(expandedKeys.value)
  if (next.has(key))
    next.delete(key)
  else
    next.add(key)
  expandedKeys.value = next
}

function expandAll(expanded: boolean) {
  expandedKeys.value = expanded && snapshot.value ? new Set(folderKeys(snapshot.value.tree)) : new Set()
}

function resetCoreSelection() {
  if (snapshot.value)
    resetSelection(snapshot.value)
}

async function runExport() {
  const current = snapshot.value
  if (!current || !selectedFiles.value.length) {
    warning('请至少选择一个有原件正文的文件')
    return
  }
  exporting.value = true
  try {
    const result = await createProjectArchiveZip(current, {
      selectedFileIds: selectedKeys.value,
    })
    const date = new Date().toISOString().slice(0, 10)
    const exportResult = await exportFile({
      data: result.data,
      defaultName: `${sanitizeSegment(current.project.name)}_档案包_${date}.zip`,
      mimeType: 'application/zip',
    })
    if (exportResult.status === 'cancelled')
      return
    if (result.missingFiles.length)
      warning(`有 ${result.missingFiles.length} 个附件原件缺失，详情已写入文件清单`)
    open.value = false
  }
  catch (cause) {
    error(`项目档案包导出失败：${cause instanceof Error ? cause.message : '未知错误'}`)
  }
  finally {
    exporting.value = false
  }
}

async function startExport() {
  if (!selectedFiles.value.length) {
    warning('请至少选择一个有原件正文的文件')
    return
  }
  await runExport()
}

watch(
  open,
  (value) => {
    if (value)
      void loadSnapshot()
  },
  { immediate: true },
)
watch(query, (value) => {
  if (value.trim() && snapshot.value)
    expandedKeys.value = new Set(folderKeys(snapshot.value.tree))
})
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="flex h-[min(860px,calc(100dvh-24px))] w-[min(980px,calc(100dvw-24px))] min-w-0 flex-col overflow-hidden p-0" :show-close="!exporting">
      <DialogHeader class="shrink-0 border-b border-line px-5 py-4 pr-12">
        <DialogTitle>导出项目档案包 · 选择范围</DialogTitle>
        <DialogDescription class="mt-1 leading-5">
          {{ snapshot?.project.name || '正在读取项目' }} · 按统一目录合同生成 ZIP；核心档案默认勾选，证照可查看但原件导出权限待配置。
        </DialogDescription>
      </DialogHeader>

      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface-2 px-5 py-3">
        <label class="relative min-w-52 flex-1 sm:max-w-80">
          <span class="sr-only">搜索档案目录</span>
          <span class="i-lucide-search pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-13px text-ink-faint" aria-hidden="true" />
          <input v-model="query" class="input w-full pl-8" placeholder="搜索目录、分供方、班组或工人">
        </label>
        <button type="button" class="btn-secondary text-11px" :disabled="loading || exporting" @click="expandAll(true)">
          <span class="i-lucide-chevrons-down mr-1" aria-hidden="true" />展开全部
        </button>
        <button type="button" class="btn-secondary text-11px" :disabled="loading || exporting" @click="expandAll(false)">
          <span class="i-lucide-chevrons-up mr-1" aria-hidden="true" />收起
        </button>
        <button type="button" class="btn-ghost text-11px" :disabled="loading || exporting" @click="resetCoreSelection">
          恢复核心默认
        </button>
        <span class="ml-auto text-11px text-ink-faint">默认 {{ defaultSelectedCount }} 个原件</span>
      </div>

      <div class="min-h-0 flex-1 overflow-auto px-3 py-2 sm:px-5" role="tree" aria-label="项目档案导出范围">
        <StatePanel v-if="loading" kind="loading" title="正在读取项目档案目录" compact />
        <StatePanel
          v-else-if="loadError"
          kind="error"
          title="项目档案目录读取失败"
          :description="loadError"
          action-label="重新加载"
          compact
          @action="loadSnapshot"
        />
        <template v-else-if="visibleTree.length">
          <ProjectArchiveTreeNode
            v-for="node in visibleTree"
            :key="node.key"
            :node="node"
            :expanded-keys="expandedKeys"
            :selected-keys="selectedKeys"
            @toggle="toggleNode"
            @expand="toggleExpanded"
          />
        </template>
        <StatePanel v-else kind="empty" title="没有匹配的档案目录" description="可以清空搜索，或返回项目详情查看文件来源。" compact />
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface-2 px-5 py-2.5 text-11px text-ink-soft">
        <span class="i-lucide-shield-alert text-danger" aria-hidden="true" />
        <span>证照可查看 · 原件导出权限待配置 · 当前 ZIP 不包含证照原件</span>
      </div>

      <DialogFooter class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <div class="text-11px text-ink-soft">
          已选 <span class="font-mono font-700 text-brand">{{ selectedFiles.length }}</span> 个原件
          <span class="mx-1 text-ink-faint">·</span>
          证照原件不参与当前导出
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-ghost" :disabled="exporting" @click="open = false">
            取消
          </button>
          <button type="button" class="btn-primary" :disabled="loading || exporting || !selectedFiles.length" @click="startExport">
            <span v-if="exporting" class="i-lucide-loader-circle mr-1 animate-spin" aria-hidden="true" />
            <span v-else class="i-lucide-archive mr-1" aria-hidden="true" />
            {{ exporting ? '正在生成…' : '开始导出 ZIP' }}
          </button>
        </div>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
