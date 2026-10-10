import type { APIRequestContext, Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { test as base, expect } from '@playwright/test'
import { expectLocalHorizontalScroll, expectNoPageOverflow } from './helpers/responsive'

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1280, height: 900 },
  { width: 1440, height: 1000 },
] as const
const INPUTS = [
  { label: '泥工档案', customer: '合成布局甲方甲', crew: '合成泥工班甲', worker: '合成工人甲', contact: '合成联系人甲', trade: '泥工', phone: '13800000011', bank: '合成银行甲', account: '6222000000000011', referenceTime: '2026-09-08T04:00:00.000Z' },
  { label: '木工档案', customer: '合成布局甲方乙', crew: '合成木工班乙', worker: '合成工人乙', contact: '合成联系人乙', trade: '木工', phone: '13900000022', bank: '合成银行乙', account: '6222000000000022', referenceTime: '2024-02-29T04:00:00.000Z' },
] as const

interface RegistryRecord {
  kind: 'customer' | 'crew' | 'worker'
  heading: string
  record: string
  id: string
  table: string
}

async function createRecord(request: APIRequestContext, kind: RegistryRecord['kind'], draft: Record<string, unknown>) {
  const response = await request.post(`/api/commands/${kind}s`, {
    data: {
      workspaceId: 'workspace-default',
      actorId: 'actor-default',
      requiredCapability: `${kind}:write`,
      commandId: randomUUID(),
      baseVersion: null,
      action: 'save',
      draft,
      attachments: {},
    },
  })
  expect(response.ok(), await response.text()).toBe(true)
  return (await response.json() as { id: string }).id
}

const test = base.extend<{ input: (typeof INPUTS)[number], registries: RegistryRecord[] }>({
  input: [INPUTS[0], { option: true }],
  registries: async ({ page, input }, use) => {
    const headers = { 'x-ruihang-test-session': `master-list-${randomUUID()}` }
    await page.context().setExtraHTTPHeaders(headers)
    await page.clock.install({ time: new Date(input.referenceTime) })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
    const request = page.context().request
    for (const entity of ['customers', 'crew-workers']) {
      const response = await request.post(`/api/testing/${entity}/reset`, {
        headers: { 'x-ruihang-test-reset': '1' },
        data: { scenario: 'ready' },
      })
      expect(response.ok()).toBe(true)
    }
    const customerId = await createRecord(request, 'customer', { name: input.customer, contact: input.contact, contactPhone: input.phone })
    const crewId = await createRecord(request, 'crew', { name: input.crew, trade: input.trade, contactName: input.contact, contactPhone: input.phone, assignmentLevel: 'worker', defaultPayRatio: 1, capabilityTrades: [input.trade] })
    const workerId = await createRecord(request, 'worker', { name: input.worker, trade: input.trade, phone: input.phone, bankName: input.bank, bankAccount: input.account, crewId, projectStatus: '在场', capabilityTrades: [input.trade], safetyEducation: true })
    await use([
      { kind: 'customer', heading: '客户档案', record: input.customer, id: customerId, table: 'customer-list-table' },
      { kind: 'crew', heading: '班组资料库', record: input.crew, id: crewId, table: 'crew-central-list-table' },
      { kind: 'worker', heading: '工人资料库', record: input.worker, id: workerId, table: 'worker-central-list-table' },
    ])
  },
})

async function expectRecordTarget(page: Page, registry: RegistryRecord) {
  const link = page.getByRole('link', { name: registry.record, exact: true }).filter({ visible: true })
  await expect(link).toBeVisible()
  const href = await link.getAttribute('href')
  expect(href).toMatch(/^\/(?!\/)/)
  const target = new URL(href!, page.url())
  expect(target.origin).toBe(new URL(page.url()).origin)
  expect(target.pathname).toBe(`/base/${registry.kind}/${registry.id}`)
  expect(target.searchParams.get('origin')).toBe('real')
  const returnTarget = new URL(target.searchParams.get('returnTo')!, page.url())
  expect(returnTarget.origin).toBe(target.origin)
  expect(returnTarget.pathname).toBe(`/base/${registry.kind}`)
  return { link, target }
}

for (const input of INPUTS) {
  test.describe(`Issue #194：客户、班组、工人列表 · ${input.label}`, () => {
    test.use({ input })
    test('三类正式档案在各宽度保持紧凑工具栏和页面级无横滚', async ({ page, registries }) => {
      for (const registry of registries) {
        await page.goto(`/base/${registry.kind}`)
        await expect(page.getByRole('heading', { name: registry.heading, exact: true })).toBeVisible()
        await expectRecordTarget(page, registry)
        for (const viewport of VIEWPORTS) {
          await page.setViewportSize(viewport)
          await expectNoPageOverflow(page, `${registry.heading} @ ${viewport.width}px`)
        }
      }
    })

    test('窄窗表格各自在局部承载横向滚动', async ({ page, registries }) => {
      await page.setViewportSize(VIEWPORTS[0])
      for (const registry of registries) {
        await page.goto(`/base/${registry.kind}`)
        await expectRecordTarget(page, registry)
        await expectLocalHorizontalScroll(
          page.locator(`[data-ui="${registry.table}"] .vxe-table--body-inner-wrapper`).first(),
          `${registry.heading}表格`,
        )
        await expectNoPageOverflow(page, `${registry.heading}窄窗`)
      }
    })

    test('键盘可从列表进入详情，搜索无结果后可清除筛选', async ({ page, registries }) => {
      const worker = registries.find(record => record.kind === 'worker')!
      await page.goto('/base/worker')
      const { link, target } = await expectRecordTarget(page, worker)
      await link.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(target.href)
      await expect(page.getByRole('heading', { name: worker.record, exact: true })).toBeVisible()
      await page.goto('/base/worker')
      const search = page.getByRole('searchbox', { name: '搜索姓名、手机号、证件号…' })
      await search.fill(`${input.worker}不存在的记录`)
      await expect(page.getByRole('status', { name: '没有符合条件的记录' })).toBeVisible()
      await page.getByRole('button', { name: '清除筛选', exact: true }).click()
      await expect(search).toHaveValue('')
      await expectRecordTarget(page, worker)
    })
  })
}
