import type { Component } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page } from 'vitest/browser'
import { computed, nextTick, onUnmounted, shallowRef, useTemplateRef, watch } from 'vue'
import * as XLSX from 'xlsx'
import ImportMappingStep from '~/components/import/ImportMappingStep.vue'
import ImportPreviewStep from '~/components/import/ImportPreviewStep.vue'
import ImportUploadStep from '~/components/import/ImportUploadStep.vue'
import ProjectImportReview from '~/components/project/ProjectImportReview.vue'
import ProjectImportScreen from '~/components/project/ProjectImportScreen.vue'
import KitButton from '~/components/ui/KitButton.vue'
import ProcessStepper from '~/components/ui/ProcessStepper.vue'
import { useImportRunner } from '~/composables/useImportRunner'
import { useProjectImport } from '~/composables/useProjectImport'

afterEach(() => vi.unstubAllGlobals())

it('关闭项目导入页时，等待界面渲染中尚未开始的行不会写入', async () => {
  let release!: () => void
  let waiting!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const reachedGate = new Promise<void>((resolve) => {
    waiting = resolve
  })
  const writes = vi.fn(async (row: Record<string, unknown>) => ({ id: `synthetic-${row.name}` }))
  const commands = {
    validateImportRow: vi.fn(async () => null),
    prepareImportRow: vi.fn(async () => ({ draft: { customerId: 'synthetic-customer', status: '立项' } })),
    importRow: writes,
  }
  const close = vi.fn()
  const replace = vi.fn(async () => {})
  const route = { fullPath: '/import/mapping/project' }
  for (const [key, value] of Object.entries({
    shallowRef,
    computed,
    onUnmounted,
    watch,
    nextTick,
    useTemplateRef,
    useProjectImport,
    useProjectCommandStore: () => commands,
    useImportRunner: () => useImportRunner({
      yieldToView: async () => {
        waiting()
        await gate
      },
    }),
    useRoute: () => route,
    useRouter: () => ({ currentRoute: shallowRef(route), replace }),
    useTabsStore: () => ({ close }),
    useKitUI: () => ({ exportFile: vi.fn(), success: vi.fn() }),
    useTabTitle: () => {},
  })) vi.stubGlobal(key, value)

  const components: Record<string, Component> = { ImportMappingStep, ImportPreviewStep, ImportUploadStep, ProjectImportReview, KitButton, ProcessStepper }
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ['项目名称', '客户', '项目经理'],
    ['合成项目一', '合成客户', '合成经理'],
    ['合成项目二', '合成客户', '合成经理'],
  ]), '项目')
  const file = new File([XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], '合成项目.xlsx')
  try {
    await render(ProjectImportScreen, { global: { components } })
    await page.getByLabelText('选择导入文件').upload(file)
    await page.getByRole('button', { name: '使用此工作表' }).click()
    await page.getByRole('button', { name: '下一步' }).click()
    await expect.element(page.getByText('共 2 行待导入', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: '开始导入' }).click()
    await reachedGate
    await page.getByRole('button', { name: '停止并返回列表' }).click()
    await expect.element(page.getByRole('button', { name: '等待当前行结束' })).toBeDisabled()
    expect(writes).not.toHaveBeenCalled()
    expect(close).not.toHaveBeenCalled()
    release()
    await expect.poll(() => replace.mock.calls.length).toBe(1)
    expect(close).toHaveBeenCalledExactlyOnceWith('/import/mapping/project')
    expect(replace).toHaveBeenCalledExactlyOnceWith('/project')
    expect(writes).not.toHaveBeenCalled()
  }
  finally { release() }
})
