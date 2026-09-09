<script setup lang="ts">
import type { ImportRunResult } from '~/composables/useImportRunner'
import { Button } from '~/components/ui/button'

const flow = useProjectImport()
const { fields, sheet, mapping, excluded, step, preparing, previewError, reviewed, saved, entries, missing, fieldStatus, steps, runner } = flow
const { phase, error, done, total, rejected } = runner
const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const fullPath = route.fullPath
const { exportFile, success } = useKitUI()
const title = useTemplateRef('title')
const exportError = shallowRef('')
const closing = shallowRef(false)
watch(step, async () => {
  await nextTick()
  title.value?.focus()
})
useTabTitle(() => '导入项目')

async function close() {
  if (closing.value)
    return
  closing.value = true
  await flow.stop()
  tabs.close(fullPath)
  if (router.currentRoute.value.fullPath === fullPath)
    await router.replace('/project')
}
async function settle(result: ImportRunResult | undefined) {
  if (flow.cancelled.value)
    return
  if (result?.status === 'completed' && !result.rejected?.length) {
    success(`已导入 ${saved.value.length} 行：施工项目`)
    await close()
  }
}
async function downloadRejected() {
  const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`
  const rows = [['来源文件', 'Sheet', '原始行', '外部旧ID', '项目', '拒绝原因'], ...rejected.value.map((item) => {
    const source = flow.source(item.row)
    return [source?.fileName, source?.sheetName, source?.rowNumber, source?.externalRef, item.row.name, item.reason]
  })]
  try {
    await exportFile({ data: `\ufeff${rows.map(row => row.map(cell).join(',')).join('\r\n')}`, defaultName: '项目导入_拒绝清单.csv', mimeType: 'text/csv;charset=utf-8' })
  }
  catch (cause) { exportError.value = cause instanceof Error ? cause.message : '拒绝清单下载失败' }
}
</script>

<template>
  <main class="mx-auto w-full min-w-0 max-w-6xl py-3" aria-labelledby="project-import-title">
    <header class="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 id="project-import-title" ref="title" tabindex="-1" class="text-18px text-ink font-800 outline-none">
          导入项目
        </h1>
        <p class="mt-1 break-all text-12px text-ink-soft">
          {{ sheet ? `${sheet.sourceFileName} · ${sheet.name} · ${sheet.rows.length} 行` : '选择 Excel / CSV，核对映射和客户后保存项目' }}
        </p>
      </div>
      <span class="chip-brand">正式项目 · 独立导入页签</span>
    </header>
    <div class="mb-5 border border-line rounded bg-panel p-3">
      <ProcessStepper :steps="steps" />
    </div>
    <section v-if="step === 'upload'" aria-label="第一步：上传项目">
      <ImportUploadStep choose-sheet @loaded="flow.loaded" />
      <div class="mt-4 flex justify-end">
        <Button variant="ghost" @click="close">
          取消
        </Button>
      </div>
    </section>
    <section v-else-if="step === 'mapping'" aria-label="第二步：映射项目">
      <fieldset :disabled="preparing" class="min-w-0 border-0 p-0">
        <legend class="sr-only">
          项目列映射
        </legend>
        <ImportMappingStep :fields="fields" :columns="sheet?.columns ?? []" :mapping="mapping" :status="fieldStatus" @select="flow.select" @confirm="flow.confirm" />
      </fieldset>
      <p v-if="missing.length" class="mt-3 text-12px text-danger-ink" role="alert">
        必填字段未映射：{{ missing.map(field => field.label).join('、') }}
      </p>
      <p v-if="previewError" class="mt-3 break-words text-12px text-danger-ink" role="alert">
        {{ previewError }}
      </p>
      <div class="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" @click="close">
          取消
        </Button>
        <Button variant="outline" :disabled="preparing" @click="step = 'upload'">
          重新上传
        </Button>
        <KitButton variant="primary" :disabled="!!missing.length" :loading="preparing" @click="flow.preview">
          下一步
        </KitButton>
      </div>
    </section>
    <section v-else aria-label="第三步：预览与导入项目">
      <ProjectImportReview :entries="entries" :reviewed="reviewed" />
      <ImportPreviewStep :fields="fields" :entries="entries" :removed-count="excluded.size" :locked="phase !== 'idle'" @remove="flow.remove" />
      <section v-if="phase !== 'idle'" class="mt-4 border border-line rounded bg-panel p-3" aria-label="项目导入结果">
        <p class="text-13px font-700" role="status">
          已成功 {{ saved.length }} 行 · 未导入 {{ rejected.length }} 行 · 本轮已处理 {{ done }}/{{ total }} 行
        </p>
        <p v-if="phase === 'failed'" class="mt-2 break-words text-12px text-danger-ink" role="alert">
          {{ error }}。当前行尚未确认完成，重试不会重复创建已保存项目。
        </p>
        <div v-if="rejected.length" class="mt-3 max-h-64 overflow-auto" tabindex="0" role="region" aria-label="项目行级拒绝清单">
          <table class="w-full whitespace-nowrap text-left text-12px">
            <thead>
              <tr>
                <th class="p-2">
                  原始行
                </th><th class="p-2">
                  项目
                </th><th class="p-2">
                  拒绝原因
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in rejected" :key="item.index" class="border-t border-line">
                <td class="p-2">
                  {{ flow.source(item.row)?.rowNumber }}
                </td><td class="p-2">
                  {{ item.row.name || '—' }}
                </td><td class="p-2 text-danger-ink">
                  {{ item.reason }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="rejected.length" class="mt-2 text-12px text-ink-soft">
          修复客户资料或权限后可重试未导入行；文件内容有误请修正后重新上传。相同外部旧 ID 的已保存项目不会被覆盖。
        </p>
        <div v-if="saved.length" class="mt-3 flex flex-wrap gap-3" aria-label="已导入项目">
          <NuxtLink v-for="item in saved" :key="item.index" :to="`/project/${encodeURIComponent(item.id)}?origin=real`" class="text-12px text-brand underline">
            {{ item.name }}
          </NuxtLink>
        </div>
      </section>
      <p v-if="exportError" class="mt-3 text-danger-ink" role="alert">
        {{ exportError }}
      </p>
      <div class="mt-4 flex flex-wrap items-center justify-between gap-3 border border-line rounded bg-panel p-3">
        <p class="text-12px text-ink-soft">
          逐行保存；取消会在当前行结束后停止，其余行不再提交。
        </p>
        <div class="flex flex-wrap gap-2">
          <Button variant="ghost" :disabled="closing" @click="close">
            {{ closing ? '等待当前行结束' : phase === 'running' ? '停止并返回列表' : '返回项目列表' }}
          </Button>
          <Button v-if="phase === 'idle'" variant="outline" @click="step = 'mapping'">
            上一步
          </Button>
          <Button v-if="rejected.length" variant="outline" @click="downloadRejected">
            下载拒绝清单
          </Button>
          <KitButton v-if="phase === 'idle'" variant="primary" :disabled="!entries.length" @click="flow.start().then(settle)">
            开始导入
          </KitButton>
          <KitButton v-if="phase === 'failed' || (phase === 'completed' && rejected.length)" variant="primary" @click="flow.retry().then(settle)">
            重试未导入行
          </KitButton>
        </div>
      </div>
    </section>
  </main>
</template>
