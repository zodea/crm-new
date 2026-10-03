import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installProjectCentralFixture, PROJECT_INPUTS } from './helpers/project-central-fixture'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  tabUntilFocused,
} from './helpers/responsive'

interface FormRoute {
  path: string
  title: string
  prepare?: (page: Page) => Promise<void>
}

interface RepresentativeForm extends FormRoute {
  listPath: string
  primaryAction: string
  firstField: (page: Page) => Locator
}

async function preparePaymentForm(page: Page) {
  await expect(page.getByRole('heading', { name: '选择付款业务类型' })).toBeVisible({
    timeout: 20_000,
  })
  const paymentType = page.getByRole('button', { name: '有合同-材料', exact: true })
  await paymentType.focus()
  await expect(paymentType).toBeFocused()
  await page.keyboard.press('Enter')
}

const REPRESENTATIVE_FORMS: RepresentativeForm[] = [
  {
    path: '/base/supplier/form',
    title: '新建 · 分供方',
    listPath: '/base/supplier',
    primaryAction: '保存',
    firstField: page => page.getByLabel('公司全称 *'),
  },
  {
    path: '/finance/payment/new',
    title: '新建 · 付款申请',
    listPath: '/finance/payment',
    primaryAction: '保存',
    firstField: page => page.getByTestId('finance-name'),
    prepare: preparePaymentForm,
  },
  {
    path: '/material/arrival/new',
    title: '新建 · 材料到货',
    listPath: '/material/arrival',
    primaryAction: '保存',
    firstField: page => page.getByTestId('material-no'),
  },
  {
    path: '/owner/report/new',
    title: '新建 · 甲方报量',
    listPath: '/owner/report',
    primaryAction: '保存并申报',
    firstField: page => page.getByTestId('owner-document-no'),
  },
  {
    path: '/contract/material/form',
    title: '新建 · 材料采购合同',
    listPath: '/contract/material',
    primaryAction: '保存',
    firstField: page => page.getByTestId('contract-name'),
  },
]

async function openRepresentativeForm(
  page: Page,
  form: FormRoute,
) {
  await page.goto(form.path)
  if (form.prepare)
    await form.prepare(page)
  await expect(page.getByRole('heading', { name: form.title })).toBeVisible({
    timeout: 20_000,
  })
}

async function expectFieldToActionsKeyboardPath(page: Page, form: RepresentativeForm) {
  const firstField = form.firstField(page)
  await expect(firstField).toBeVisible()
  await firstField.focus()
  await expect(firstField).toBeFocused()

  const footer = page.getByRole('group', { name: '表单操作' })
  await expect(footer).toBeVisible()
  const cancel = footer.getByRole('button', { name: '取消', exact: true })
  const primaryAction = footer.getByRole('button', {
    name: form.primaryAction,
    exact: true,
  })

  await tabUntilFocused(page, cancel)
  await expect(cancel).toBeFocused()
  await expect(cancel).toBeInViewport()
  await tabUntilFocused(page, primaryAction)
  await expect(primaryAction).toBeFocused()
  await expect(primaryAction).toBeInViewport()

  return { cancel, firstField, primaryAction }
}

test.describe('#112 R3-B 整页表单增量验收', () => {
  test.beforeEach(async ({ page }) => {
    await installProjectCentralFixture(page)
  })
  for (const width of [390, 768, 1024, 1280, 1440]) {
    for (const form of REPRESENTATIVE_FORMS) {
      test(`${form.title}在 ${width}px 下可由字段自然 Tab 到取消与主操作`, async ({ page }) => {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        })

        await openRepresentativeForm(page, form)
        await expectNoPageOverflow(page, `${form.path} @ ${width}px`)
        await expectFieldToActionsKeyboardPath(page, form)
      })
    }
  }

  for (const input of ['合成未保存输入甲', '合成未保存输入乙']) {
    for (const form of REPRESENTATIVE_FORMS) {
      test(`${input}${form.title}200% 等效布局下筛选、字段、取消确认、焦点返回与主操作均可达`, async ({ page }) => {
        // 1440px 显示器在浏览器 200% 缩放下约等于 720 CSS px 布局视口。
        await page.setViewportSize(EQUIVALENT_200_PERCENT_VIEWPORT)

        await openRepresentativeForm(page, form)
        await expectNoPageOverflow(page, `${form.path} @ 720px`)

        if (form.path === '/contract/material/form') {
          const projectFilter = page.getByLabel('检索项目')
          await projectFilter.focus()
          await expect(projectFilter).toBeFocused()
          await page.keyboard.type(PROJECT_INPUTS[0].name)
          await expect(page.getByRole('option', { name: new RegExp(PROJECT_INPUTS[0].name) }))
            .toBeVisible()
          await page.keyboard.press('Escape')
          await expect(projectFilter).toBeFocused()
        }

        const firstField = form.firstField(page)
        await firstField.fill(`${input}-${form.title}`)
        const { cancel, primaryAction } = await expectFieldToActionsKeyboardPath(page, form)
        await expect(primaryAction).toBeFocused()
        await tabUntilFocused(page, cancel, 'backward', 10)
        await page.keyboard.press('Enter')

        const dialog = page.getByRole('dialog', { name: '放弃修改' })
        await expect(dialog).toBeVisible()
        const dialogCancel = dialog.getByRole('button', { name: '取消', exact: true })
        await expect(dialogCancel).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
        await expect(cancel).toBeFocused()

        await page.keyboard.press('Enter')
        await expect(dialog).toBeVisible()
        await expect(dialogCancel).toBeFocused()
        const discard = dialog.getByRole('button', { name: '放弃修改', exact: true })
        await page.keyboard.press('Tab')
        await expect(discard).toBeFocused()
        await page.keyboard.press('Enter')
        await expect.poll(() => new URL(page.url()).pathname).toBe(form.listPath)
      })
    }
  }
  const denseForms = [
    {
      path: '/finance/payment/new',
      title: '新建 · 付款申请',
      prepare: preparePaymentForm,
      addLine: async (page: Page) => page.getByTestId('add-grid-line').first().click(),
      root: (page: Page) => page.getByTestId('finance-line-grid').first().locator(':scope > .overflow-auto'),
      lastAction: (page: Page) => page
        .getByTestId('finance-line-grid')
        .first()
        .getByTitle('删除')
        .last(),
    },
    {
      path: '/finance/reimbursement/new',
      title: '新建 · 费用报销',
      addLine: async (page: Page) => page.getByTestId('add-grid-line').click(),
      root: (page: Page) => page.getByTestId('finance-line-grid').locator(':scope > .overflow-auto'),
      lastAction: (page: Page) => page
        .getByTestId('finance-line-grid')
        .getByTitle('删除')
        .last(),
    },
    {
      path: '/material/arrival/new',
      title: '新建 · 材料到货',
      addLine: async (page: Page) => page.getByTestId('add-material-line').click(),
      root: (page: Page) => page.getByTestId('material-line-grid')
        .locator(':scope > .overflow-auto'),
      lastAction: (page: Page) => page
        .getByTestId('material-line-grid')
        .getByTitle('删除')
        .last(),
    },
    {
      path: '/owner/report/new',
      title: '新建 · 甲方报量',
      addLine: async (page: Page) => page.getByTestId('owner-document-add-line').click(),
      root: (page: Page) => page.locator('#section-lines')
        .locator(':scope > .overflow-auto'),
      lastAction: (page: Page) => page
        .locator('#section-lines')
        .getByTitle('删除')
        .last(),
    },
    {
      path: '/owner/change/new',
      title: '新建 · 甲方变洽签',
      addLine: async (page: Page) => page.getByTestId('owner-document-add-line').click(),
      root: (page: Page) => page.locator('#section-lines')
        .locator(':scope > .overflow-auto'),
      lastAction: (page: Page) => page
        .locator('#section-lines')
        .getByTitle('删除')
        .last(),
    },
    {
      path: '/contract/material/form',
      title: '新建 · 材料采购合同',
      addLine: async (page: Page) => page.getByTestId('add-contract-line').click(),
      root: (page: Page) => page.locator('#section-lines')
        .locator('.vxe-table--body-inner-wrapper')
        .first(),
      lastAction: (page: Page) => page
        .locator('#section-lines')
        .getByRole('textbox', { name: '备注，第 1 行' }),
    },
  ] satisfies Array<FormRoute & {
    addLine: (page: Page) => Promise<void>
    root: (page: Page) => Locator
    lastAction: (page: Page) => Locator
  }>

  for (const form of denseForms) {
    test(`${form.title}390px 明细只在自身容器单层横向滚动且末列可达`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 })
      await openRepresentativeForm(page, form)
      await form.addLine(page)
      const scrollRoot = form.root(page)
      await expectLocalHorizontalScroll(scrollRoot, `${form.path} 明细`)
      await expect.poll(() => scrollRoot.evaluate(root =>
        [...root.querySelectorAll<HTMLElement>('*')].filter((element) => {
          const overflowX = getComputedStyle(element).overflowX
          return ['auto', 'scroll'].includes(overflowX)
            && element.scrollWidth > element.clientWidth + 1
        }).length,
      )).toBe(0)
      await scrollRoot.evaluate(root => root.scrollLeft = root.scrollWidth)
      await expect.poll(() => scrollRoot.evaluate(root => root.scrollLeft)).toBeGreaterThan(0)
      const lastAction = form.lastAction(page)
      await lastAction.scrollIntoViewIfNeeded()
      await expect(lastAction).toBeInViewport()
      await expectNoPageOverflow(page, `${form.path} @ 390px`)
    })
  }
})
