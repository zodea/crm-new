import type { Locator, Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  EQUIVALENT_200_PERCENT_VIEWPORT,
  expectLocalHorizontalScroll,
  expectNoPageOverflow,
  RESPONSIVE_WIDTHS,
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
  await expect(page.getByRole('heading', { name: '选择付款业务类型' })).toBeVisible()
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
  for (const width of RESPONSIVE_WIDTHS) {
    test(`五个领域代表表单在 ${width}px 下可由字段自然 Tab 到取消与主操作`, async ({ page }) => {
      test.setTimeout(180_000)
      await page.setViewportSize({
        width,
        height: width === 390 ? 844 : 900,
      })

      for (const form of REPRESENTATIVE_FORMS) {
        await openRepresentativeForm(page, form)
        await expectNoPageOverflow(page, `${form.path} @ ${width}px`)
        await expectFieldToActionsKeyboardPath(page, form)
      }
    })
  }

  test('200% 等效布局下筛选、字段、取消确认、焦点返回与主操作均可达', async ({ page }) => {
    test.setTimeout(180_000)
    // 1440px 显示器在浏览器 200% 缩放下约等于 720 CSS px 布局视口。
    await page.setViewportSize(EQUIVALENT_200_PERCENT_VIEWPORT)

    for (const form of REPRESENTATIVE_FORMS) {
      await openRepresentativeForm(page, form)
      await expectNoPageOverflow(page, `${form.path} @ 720px`)

      if (form.path === '/contract/material/form') {
        const projectFilter = page.getByLabel('检索项目')
        await projectFilter.focus()
        await expect(projectFilter).toBeFocused()
        await page.keyboard.type('合和')
        await expect(page.getByRole('option').filter({ hasText: '合和新城' }).first())
          .toBeVisible()
        await page.keyboard.press('Escape')
        await expect(projectFilter).toBeFocused()
      }

      const firstField = form.firstField(page)
      await firstField.fill(`R3-B-${form.title}`)
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
      await expect(page).toHaveURL(form.listPath)
    }
  })

  test('390px 下四类密集明细只在自身容器横向滚动', async ({ context }) => {
    const denseForms = [
      {
        path: '/finance/payment/new',
        title: '新建 · 付款申请',
        prepare: preparePaymentForm,
        addLine: async (page: Page) => page.getByTestId('add-grid-line').first().click(),
        root: (page: Page) => page.getByTestId('finance-line-grid').first(),
      },
      {
        path: '/material/arrival/new',
        title: '新建 · 材料到货',
        addLine: async (page: Page) => page.getByTestId('add-material-line').click(),
        root: (page: Page) => page.getByTestId('material-line-grid'),
      },
      {
        path: '/owner/report/new',
        title: '新建 · 甲方报量',
        addLine: async (page: Page) => page.getByTestId('owner-document-add-line').click(),
        root: (page: Page) => page.locator('#section-lines'),
      },
      {
        path: '/contract/material/form',
        title: '新建 · 材料采购合同',
        addLine: async (page: Page) => page.getByTestId('add-contract-line').click(),
        root: (page: Page) => page.locator('#section-lines'),
      },
    ] satisfies Array<FormRoute & {
      addLine: (page: Page) => Promise<void>
      root: (page: Page) => Locator
    }>

    for (const form of denseForms) {
      const page = await context.newPage()
      try {
        await page.setViewportSize({ width: 390, height: 844 })
        await openRepresentativeForm(page, form)
        await form.addLine(page)
        await expectLocalHorizontalScroll(form.root(page), `${form.path} 明细`)
        await expectNoPageOverflow(page, `${form.path} @ 390px`)
      }
      finally {
        await page.close()
      }
    }
  })
})
