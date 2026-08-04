<script setup lang="ts">
import type { ImportRunResult } from '~/composables/useImportRunner'
import type { ImportColumnMatch, ImportStepId } from '~/lib/kit/import-mapping'
import type { RawImportSheet } from '~/lib/util/excel'
import { Button } from '~/components/ui/button'
import { getImportEntity } from '~/lib/kit/import-entities'
import {
  autoMatchColumns,
  buildImportRows,
  computeFieldStatus,
  importStepperSteps,
  listMissingRequiredFields,
} from '~/lib/kit/import-mapping'

const route = useRoute()
const router = useRouter()
const tabsStore = useTabsStore()
const toast = useToast()

// app.vue 以 fullPath 作为 page-key；此处捕获身份，不在 KeepAlive 实例中
// 持续读取全局 route.params，避免切换页签后串实体。
const entityKey = String(route.params.entity)
const tabFullPath = route.fullPath
const entity = getImportEntity(entityKey)
const fields = entity?.fields ?? []

const currentStep = shallowRef<ImportStepId>('upload')
const sheet = shallowRef<RawImportSheet | null>(null)
const mapping = shallowRef<Readonly<Record<string, ImportColumnMatch>>>({})
const excludedRows = shallowRef<ReadonlySet<number>>(new Set())
const runner = useImportRunner()
const { done, error, phase, total } = runner

const steps = computed(() => importStepperSteps({
  currentStep: currentStep.value,
  runPhase: phase.value,
}))
const fieldStatus = computed(() => computeFieldStatus(mapping.value, fields))
const missingRequired = computed(() => listMissingRequiredFields(mapping.value, fields))
const allRows = computed(() => buildImportRows(mapping.value, sheet.value?.rows ?? []))
const keptEntries = computed(() => allRows.value
  .map((row, index) => ({ index, row }))
  .filter(entry => !excludedRows.value.has(entry.index)))
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round((done.value / total.value) * 100))

// 预占式页签下该回填暂不生效（AppTabBar 静态标题最后覆盖），机制修复见 #98。
useTabTitle(() => entity ? `导入映射 · ${entity.label}` : '导入映射')

function onLoaded(parsed: RawImportSheet) {
  sheet.value = parsed
  mapping.value = autoMatchColumns(parsed.columns, fields)
  excludedRows.value = new Set()
  runner.reset()
  currentStep.value = 'mapping'
}

function selectColumn(fieldKey: string, column: string | null) {
  const next = { ...mapping.value }
  if (column)
    next[fieldKey] = { column, confidence: 'confirmed' }
  else
    delete next[fieldKey]
  mapping.value = next
}

function confirmSuggestion(fieldKey: string) {
  const match = mapping.value[fieldKey]
  if (match)
    mapping.value = { ...mapping.value, [fieldKey]: { ...match, confidence: 'confirmed' } }
}

function goPreview() {
  if (missingRequired.value.length)
    return
  currentStep.value = 'preview-import'
}

function backToUpload() {
  currentStep.value = 'upload'
}

function backToMapping() {
  // 已开始导入（含失败半途）不允许回改映射，避免重复入库已成功行。
  if (phase.value !== 'idle')
    return
  currentStep.value = 'mapping'
}

function removeRow(index: number) {
  if (phase.value !== 'idle')
    return
  excludedRows.value = new Set([...excludedRows.value, index])
}

async function closeImportTab() {
  tabsStore.close(tabFullPath)
  if (router.currentRoute.value.fullPath === tabFullPath)
    await router.replace(tabsStore.activeFullPath)
}

async function settle(result: ImportRunResult) {
  if (result.status === 'completed') {
    toast.success(`已导入 ${done.value} 行：${entity!.label}`)
    await closeImportTab()
  }
}

async function startImport() {
  if (!entity || phase.value === 'running' || !keptEntries.value.length)
    return
  await settle(await runner.start(keptEntries.value.map(entry => entry.row), entity.importRow))
}

async function retryImport() {
  if (phase.value === 'running')
    return
  await settle(await runner.retry())
}

// 页签被 X 关闭/卸载时停止后台入库：当前行完成后不再推进，
// 避免卸载后静默失败或对已关页签弹结果。
onUnmounted(() => {
  runner.cancel()
})
</script>

<template>
  <main class="mx-auto max-w-4xl py-3" aria-labelledby="import-mapping-title">
    <template v-if="entity">
      <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div class="mb-1 flex items-center gap-2 text-brand">
            <span class="i-lucide-file-input h-4 w-4" aria-hidden="true" />
            <span class="text-11px font-700 tracking-wide uppercase">Import workflow</span>
          </div>
          <h1 id="import-mapping-title" class="text-18px text-ink font-800">
            导入映射
          </h1>
          <p class="mt-1 text-12px text-ink-soft">
            {{ entity.label }} · 模板驱动，源列映射到系统字段
          </p>
        </div>
        <span class="chip-brand">独立页签 · 完成后自动关闭</span>
      </header>

      <div class="mb-5 border border-line rounded-[var(--radius-card)] bg-panel p-4">
        <ProcessStepper :steps="steps" />
      </div>

      <section v-if="currentStep === 'upload'" aria-label="第一步：上传">
        <InvoiceWorkbookUploadStep v-if="entityKey === 'invoice'" @loaded="onLoaded" />
        <ImportUploadStep v-else @loaded="onLoaded" />
        <div class="mt-4 flex justify-end">
          <Button variant="ghost" @click="closeImportTab">
            取消
          </Button>
        </div>
      </section>

      <section v-else-if="currentStep === 'mapping'" aria-label="第二步：映射">
        <ImportMappingStep
          :fields="fields"
          :columns="sheet?.columns ?? []"
          :mapping="mapping"
          :status="fieldStatus"
          @select="selectColumn"
          @confirm="confirmSuggestion"
        />

        <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3">
          <p
            v-if="missingRequired.length"
            class="text-11px text-danger-ink font-600"
            role="alert"
          >
            必填字段未映射：{{ missingRequired.map(field => field.label).join('、') }}
          </p>
          <p v-else class="text-11px text-ink-faint">
            必填字段已全部映上，可进入预览。
          </p>
          <div class="flex items-center gap-2">
            <Button variant="ghost" @click="closeImportTab">
              取消
            </Button>
            <Button variant="outline" @click="backToUpload">
              重新上传
            </Button>
            <KitButton variant="primary" :disabled="missingRequired.length > 0" @click="goPreview">
              下一步
            </KitButton>
          </div>
        </div>
      </section>

      <section v-else aria-label="第三步：预览与导入">
        <ImportPreviewStep
          :fields="fields"
          :entries="keptEntries"
          :removed-count="excludedRows.size"
          :locked="phase !== 'idle'"
          @remove="removeRow"
        />

        <div
          v-if="phase !== 'idle'"
          class="mt-4 border border-line rounded-[var(--radius-card)] bg-panel p-3"
        >
          <div class="mb-1.5 flex items-center justify-between gap-3 text-12px">
            <span class="text-ink-soft font-600">导入进度</span>
            <span class="text-ink font-mono tabular-nums" aria-live="polite">
              {{ done }}/{{ total }} 行
            </span>
          </div>
          <ProgressBar
            :percent="progressPercent"
            :tone="phase === 'failed' ? 'danger' : phase === 'completed' ? 'ok' : 'brand'"
            label="导入进度"
            :valuetext="`已导入 ${done}/${total} 行`"
          />
        </div>

        <div
          v-if="phase === 'failed'"
          class="mt-4 border border-danger/35 rounded-[var(--radius-btn)] bg-danger-soft p-3"
          role="alert"
        >
          <p class="text-13px text-danger-ink font-700">
            {{ error || '导入失败，请重试' }}
          </p>
          <p class="mt-1 text-11px text-ink-soft">
            已成功的 {{ done }} 行不会重复导入，重试将从失败行继续。
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <KitButton variant="danger" @click="retryImport">
              重试失败行
            </KitButton>
            <Button variant="ghost" @click="closeImportTab">
              取消
            </Button>
          </div>
        </div>

        <div
          v-else
          class="mt-4 flex flex-wrap items-center justify-between gap-3 border border-line rounded-[var(--radius-card)] bg-panel p-3"
        >
          <p class="text-11px text-ink-faint">
            开始后逐行写入，本页显示进度；失败保留页签并可从失败行续导。
          </p>
          <div class="flex items-center gap-2">
            <Button variant="ghost" :disabled="phase === 'running'" @click="closeImportTab">
              取消
            </Button>
            <Button variant="outline" :disabled="phase !== 'idle'" @click="backToMapping">
              上一步
            </Button>
            <KitButton
              variant="accent"
              :disabled="!keptEntries.length"
              :loading="phase === 'running'"
              @click="startImport"
            >
              开始导入
            </KitButton>
          </div>
        </div>
      </section>
    </template>

    <section
      v-else
      class="border border-warn/40 rounded-[var(--radius-card)] bg-warn-soft p-6 text-center"
      role="alert"
    >
      <span class="i-lucide-file-warning mx-auto mb-2 h-7 w-7 text-warn" aria-hidden="true" />
      <h1 id="import-mapping-title" class="text-15px text-warn-ink font-800">
        导入实体未登记
      </h1>
      <p class="mx-auto mt-2 max-w-lg text-12px text-ink-soft">
        「{{ entityKey }}」不在导入实体注册表中，请从对应实体的列表页重新发起导入。
      </p>
      <Button class="mt-4" @click="closeImportTab">
        关闭此页签
      </Button>
    </section>
  </main>
</template>
