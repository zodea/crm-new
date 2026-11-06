import { expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, ref, useTemplateRef, watch } from 'vue'
import OtherSettlementInfo from '~/components/other-settlement/OtherSettlementInfo.vue'

it('冻结版本选择与来源缺口在实际视口中可操作', async ({ task }) => {
  const width = Number(task.file.projectName?.replace('chromium-', ''))
  expect([390, 768, 1024, 1280, 1440]).toContain(width)
  expect(window.innerWidth).toBe(width)
  const audit = { createdBy: '旧创建', updatedBy: '旧修改', createdAt: '旧创建时间', updatedAt: '旧修改时间', responsible: null, department: null }
  const rel = { id: null, entity: 'project', state: 'missing', label: null }
  const amounts = Object.fromEntries(['contract', 'changedContract', 'prior', 'total', 'deductions', 'net', 'taxExclusive', 'tax', 'cumulative', 'applied', 'applicable', 'paid', 'unpaid'].map(key => [key, null]))
  const old = { version: '1', actorId: '旧操作人', commandId: '旧命令', occurredAt: '旧时间', record: { id: 'synthetic', version: 1, workspaceId: 'synthetic', migrationBatchId: null, draft: { name: '旧结算', totalAmount: 0, payeeNameSnapshot: '旧收款人', originalExpenses: [{ originalExpenseLineId: 'old-expense-123', sourceVersion: '', sourceRevision: '', amount: 0 }] }, attachments: [{ id: 'old', fileName: 'old.pdf' }], audit, facts: null } }
  const latest = { ...old, version: '2', actorId: '新操作人', commandId: '新命令', record: { ...old.record, version: 2, draft: { ...old.record.draft, name: '新结算' }, attachments: [{ id: 'current', fileName: 'current.pdf' }] } }
  const detail = { settlement: { id: 'synthetic', version: '2', project: rel, contract: { ...rel, entity: 'contract' }, supplier: { ...rel, entity: 'supplier' }, draft: { name: '新结算' }, amounts, audit }, facts: [], capabilities: ['other-settlement:read'], attachments: [{ id: 'current', fileName: 'current.pdf' }], history: [old, latest] }
  for (const [key, value] of Object.entries({ computed, ref, watch, useTemplateRef, useOtherSettlementNavigation: () => ({ context: () => ({}), remember: () => {} }) })) vi.stubGlobal(key, value)
  const SectionHeader = defineComponent({ props: ['title'], template: '<h2>{{ title }}</h2>' })
  const OtherSettlementOriginalFiles = defineComponent({ props: ['files', 'version'], template: '<div><span>原件版本 {{ version }}</span><span v-for="file in files" :key="file.id">{{ file.fileName }}</span></div>' })
  const NuxtLink = defineComponent({ props: ['to'], template: '<a :href="to"><slot /></a>' })
  const Root = defineComponent({
    setup() {
      const current = ref(detail)
      function removeHistory() {
        current.value = { ...current.value, history: [latest] }
      }
      return () => h('div', [h('button', { onClick: removeHistory }, '模拟历史来源缺失'), h(OtherSettlementInfo, { detail: current.value as never })])
    },
  })
  try {
    await render(Root, { global: { components: { SectionHeader, OtherSettlementOriginalFiles, NuxtLink } } })
    const select = page.getByLabelText('查看冻结版本').element() as HTMLSelectElement
    select.focus()
    expect(document.activeElement).toBe(select)
    await userEvent.keyboard('{ArrowUp}')
    expect(select.value).toBe('1')
    await expect.element(page.getByText('old.pdf')).toBeVisible()
    await expect.element(page.getByText('旧命令', { exact: false })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: '前期信息（当前）' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: '结算信息（当前）' })).toBeVisible()
    await expect.element(page.getByRole('heading', { name: '累计与应付信息（当前）' })).toBeVisible()
    await expect.element(page.getByText('来源版本 未记录', { exact: false })).toBeVisible()
    await expect.element(page.getByText('来源修订 未记录', { exact: false })).toBeVisible()
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
    await page.getByRole('button', { name: '模拟历史来源缺失' }).click()
    await expect.element(page.getByRole('status')).toHaveTextContent('冻结版本不可用')
    expect(page.getByText('current.pdf').elements()).toHaveLength(0)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  }
  finally {
    vi.unstubAllGlobals()
  }
})
