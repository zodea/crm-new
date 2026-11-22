<script setup lang="ts">
import type { ConfiguredExportRunResult } from '~/composables/useConfiguredExportRunner'
import type {
  ConfiguredExportSettings,
  ConfiguredExportSource,
} from '~/lib/kit/export'
import { Button } from '~/components/ui/button'
import ExportConfigForm from '~/pages/export/config/_components/ExportConfigForm.vue'

const EMPTY_SOURCE: ConfiguredExportSource = {
  label: '导出任务',
  fields: [],
  files: [],
}

const route = useRoute()
const router = useRouter()
const tabsStore = useTabsStore()
const workflowsStore = useExportWorkflowsStore()
const toast = useToast()

// app.vue 以 fullPath 作为 page-key；每个工作流页签拥有独立实例。这里捕获身份，
// 不在 KeepAlive 实例中持续读取全局 route.params，避免切换其他工作流后串任务。
const jobId = String(route.params.jobId)
const tabFullPath = route.fullPath
const workflow = shallowRef(workflowsStore.get(jobId))
const source = computed(() => workflow.value?.source ?? EMPTY_SOURCE)
let instanceActive = true

// 表单只呈现两级目录/两段命名；调用方传入更多时进入页签即截断，保证预览与写盘一致
// （resolveTwoLevelFolderPath 对 >2 级抛错，不截断会让预览计算属性直接崩渲染）。
function initialSettings(): ConfiguredExportSettings {
  const fields = source.value.fields
  return {
    structure: {
      levels: workflow.value?.structure
        ? workflow.value.structure.levels.slice(0, 2)
        : fields.slice(0, 2).map(field => ({ field: field.key })),
    },
    naming: workflow.value?.naming
      ? { ...workflow.value.naming, parts: workflow.value.naming.parts.slice(0, 2) }
      : {
          parts: fields.slice(0, 2).map(field => ({ field: field.key })),
          separator: '-',
        },
  }
}

const settings = shallowRef(initialSettings())
const runner = useConfiguredExportRunner(source, settings)
const { error, running, stepper } = runner
const view = computed(() => stepper.value.phase === 'idle' ? 'config' : 'progress')

// 预占式页签下该回填暂不生效（AppTabBar 静态标题最后覆盖），机制修复见 #98。
useTabTitle(() => workflow.value ? `导出配置 · ${workflow.value.source.label}` : '导出配置')

async function closeWorkflowTab() {
  workflowsStore.remove(jobId)
  tabsStore.close(tabFullPath)
  if (router.currentRoute.value.fullPath === tabFullPath)
    await router.replace(tabsStore.activeFullPath)
}

async function settle(result: ConfiguredExportRunResult) {
  if (!instanceActive)
    return
  if (result.status === 'exported') {
    toast.success(`已导出到 ${result.displayPath} 文件夹`)
    await closeWorkflowTab()
  }
}

async function startExport() {
  if (running.value)
    return
  await settle(await runner.start())
}

async function retryExport() {
  if (running.value)
    return
  await settle(await runner.retry())
}

function backToConfig() {
  runner.reset()
}

onUnmounted(() => {
  instanceActive = false
  workflowsStore.remove(jobId)
})
</script>

<template>
  <main class="mx-auto max-w-4xl py-3" aria-labelledby="export-config-title">
    <template v-if="workflow">
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="mb-1 flex items-center gap-2 text-brand">
            <span class="i-lucide-folder-cog h-4 w-4" aria-hidden="true" />
            <span class="text-11px font-700 tracking-wide uppercase">Export workflow</span>
          </div>
          <h1 id="export-config-title" class="text-18px font-800 text-ink">
            导出配置
          </h1>
          <p class="mt-1 text-12px text-ink-soft">
            {{ source.label }} · {{ source.files.length }} 个文件
          </p>
        </div>
        <span class="chip-brand">独立页签 · 完成后自动关闭</span>
      </header>

      <section v-if="view === 'config'" aria-label="导出规则配置">
        <ExportConfigForm v-model="settings" :source="source" />

        <div class="mt-4 flex items-center justify-between gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3">
          <p class="text-11px text-ink-faint">
            开始后将在本页显示读数据、生成、写盘三步进度。
          </p>
          <div class="flex items-center gap-2">
            <Button variant="ghost" @click="closeWorkflowTab">
              取消
            </Button>
            <KitButton
              variant="accent"
              :disabled="source.files.length === 0 || settings.naming.parts.length === 0"
              :loading="running"
              @click="startExport"
            >
              开始导出
            </KitButton>
          </div>
        </div>
      </section>

      <section v-else class="border border-line rounded-[var(--radius-card)] bg-panel p-5" aria-labelledby="export-progress-title">
        <div class="mb-5">
          <h2 id="export-progress-title" class="text-15px font-800 text-ink">
            {{ stepper.phase === 'failed' ? '导出未完成' : '正在导出' }}
          </h2>
          <p class="mt-1 text-12px text-ink-soft">
            配置已锁定；失败时页签会保留，可从失败步骤重试。
          </p>
        </div>

        <ProcessStepper :steps="stepper.steps" />

        <div
          v-if="stepper.phase === 'failed'"
          class="mt-5 border border-danger/35 rounded-[var(--radius-btn)] bg-danger-soft p-3"
          role="alert"
        >
          <p class="text-13px font-700 text-danger-ink">
            {{ error || '导出失败，请重试' }}
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <KitButton variant="danger" :loading="running" @click="retryExport">
              重试失败步骤
            </KitButton>
            <Button variant="ghost" @click="backToConfig">
              返回修改配置
            </Button>
          </div>
        </div>
      </section>
    </template>

    <section v-else class="border border-warn/40 rounded-[var(--radius-card)] bg-warn-soft p-6 text-center" role="alert">
      <span class="i-lucide-file-warning mx-auto mb-2 h-7 w-7 text-warn" aria-hidden="true" />
      <h1 id="export-config-title" class="text-15px font-800 text-warn-ink">
        导出上下文已失效
      </h1>
      <p class="mx-auto mt-2 max-w-lg text-12px text-ink-soft">
        该配置页可能来自刷新或历史记录，内存中的导出数据已释放。请回到来源页面重新发起导出。
      </p>
      <Button class="mt-4" @click="closeWorkflowTab">
        关闭此页签
      </Button>
    </section>
  </main>
</template>
