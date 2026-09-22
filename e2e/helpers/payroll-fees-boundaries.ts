import type { Locator, Page, TestInfo } from '@playwright/test'
import type { PayrollAFeeConfigScope } from '../../app/lib/payroll/central-a-fees-contract'
import type { PayrollQuery, PayrollRepository } from '../../app/lib/payroll/central-contract'
import { writeFile } from 'node:fs/promises'
import { expect } from '@playwright/test'
import { PAYROLL_A_CONFIG_PATH } from '../../app/lib/payroll/a-navigation'

interface ProjectSubject {
  projectId: string
  crewId: string
  leaderWorkerId: string
}
export interface PayrollFeesBoundaryInput {
  repository: Pick<PayrollRepository, 'aFeeConfig' | 'list'>
  query: PayrollQuery
  ordinary: ProjectSubject
  management: ProjectSubject
  bookId: string
  /** 沿同批原项目检查未来未发月份，不重置或重新迁入。 */
  month?: string
}
const widths = [390, 768, 1024, 1280, 1440] as const

/** 接在主旅程真实发放/输出成功之后；只保存一份新公司代管关系。 */
export async function payrollFeesBoundaries(page: Page, info: TestInfo, input: PayrollFeesBoundaryInput) {
  const { repository, query, ordinary, management, bookId } = input
  const month = input.month ?? '2026-09'
  const subject = ({ projectId, crewId, leaderWorkerId }: ProjectSubject) => ({ projectId, crewId, leaderWorkerId, month })
  const ordinaryScope: PayrollAFeeConfigScope = { ...subject(ordinary), book: { bookPurpose: 'ordinary', managementBookId: null } }
  const managementScope: PayrollAFeeConfigScope = { ...subject(management), book: { bookPurpose: 'management', managementBookId: bookId } }
  const beforeOrdinary = await repository.aFeeConfig(query, ordinaryScope)
  const beforeManagement = await repository.aFeeConfig(query, managementScope)
  const beforeStatements = (await repository.list({ ...query, projectId: ordinary.projectId })).rows
  const captures: Array<{ name: string, width: number, localScrollers: number }> = []
  const configPath = (scope: PayrollAFeeConfigScope) => `${PAYROLL_A_CONFIG_PATH}?${new URLSearchParams({ origin: query.origin, project: scope.projectId, crew: scope.crewId!, leader: scope.leaderWorkerId!, month: scope.month, ...(scope.book.bookPurpose === 'management' ? { managementBookId: scope.book.managementBookId } : {}) })}`

  async function capture(name: string, section: Locator, captureWidths: readonly number[] = widths, scrollToEnd = false) {
    await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15000 })
    for (const width of captureWidths) {
      await page.setViewportSize({ width, height: 960 })
      await section.evaluate((node, end) => {
        node.scrollIntoView({ block: 'center', inline: 'nearest' })
        if (end)
          node.scrollTop = node.scrollHeight
      }, scrollToEnd)
      await expect(section).toBeInViewport()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      await expect.poll(() => page.locator('.shell-workspace').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: false, animations: 'disabled' })
      // 从当前表格的真实滚动容器检查右侧，不把整页横向溢出当成密集表格滚动。
      const tables = section.locator('[data-ui="kit-table"]')
      let localScrollers = 0
      for (const [index, table] of (await tables.all()).entries()) {
        const moved = await table.evaluate((node) => {
          const scrolls = [...node.querySelectorAll<HTMLElement>('*')].filter(element => /auto|scroll/.test(getComputedStyle(element).overflowX) && element.scrollWidth > element.clientWidth && element.clientWidth > 0)
          for (const element of scrolls)
            element.scrollLeft = element.scrollWidth - element.clientWidth
          return scrolls.map(element => ({ left: element.scrollLeft, maximum: element.scrollWidth - element.clientWidth }))
        })
        for (const position of moved)
          expect(position.left).toBeGreaterThan(0)
        if (moved.length) {
          localScrollers += moved.length
          await table.screenshot({ path: info.outputPath(`${name}-table-${index}-right-${width}.png`), animations: 'disabled' })
          await table.evaluate(node => node.querySelectorAll<HTMLElement>('*').forEach(element => element.scrollLeft = 0))
        }
      }
      captures.push({ name, width, localScrollers })
    }
    await page.setViewportSize({ width: 1440, height: 960 })
  }
  const fees = () => page.getByRole('region', { name: '项目主体费用与管理簿', exact: true })
  const row = () => page.getByRole('article', { name: '费用配置行', exact: true })
  const relation = () => page.getByRole('region', { name: '管理关系编辑', exact: true })
  async function assertScope(scope: PayrollAFeeConfigScope) {
    await expect(page.getByLabel('配置项目', { exact: true })).toHaveValue(scope.projectId)
    await expect(page.getByLabel('配置核对月份', { exact: true })).toHaveValue(scope.month)
    await expect(page.getByLabel('配置班组', { exact: true })).toHaveValue(scope.crewId!)
    await expect(page.getByLabel('配置负责人', { exact: true })).toHaveValue(scope.leaderWorkerId!)
    await expect(page.getByLabel('费用请款簿', { exact: true })).toHaveValue(scope.book.managementBookId ?? '')
    const actual = new URL(page.url())
    const expected = new URL(configPath(scope), actual.origin)
    expect(actual.pathname).toBe(expected.pathname)
    for (const [key, value] of expected.searchParams)
      expect(actual.searchParams.get(key), key).toBe(value)
  }
  async function sourceRoundTrip(link: Locator, name: string, scope: PayrollAFeeConfigScope) {
    await expect(link).toBeVisible()
    const href = await link.getAttribute('href')
    expect(href).toBeTruthy()
    const destination = new URL(href!, page.url())
    expect(destination.searchParams.get('payrollProject')).toBe(scope.projectId)
    expect(destination.searchParams.get('payrollSourceKind')).toBe('quantity-unit')
    const returnTo = destination.searchParams.get('payrollReturnTo')
    expect(returnTo).toBeTruthy()
    const back = new URL(returnTo!, page.url())
    for (const [key, value] of new URL(configPath(scope), page.url()).searchParams)
      expect(back.searchParams.get(key), key).toBe(value)
    await link.click()
    await expect(page).toHaveURL(destination.href)
    const returnPanel = page.getByRole('region', { name: '工资原来源返回', exact: true })
    const returnLink = returnPanel.getByRole('link', { name: '返回原工资', exact: true })
    await expect(returnLink).toBeVisible()
    await expect(returnPanel.getByRole('alert')).toHaveCount(0)
    await capture(`${name}-source`, returnPanel)
    await returnLink.click()
    await assertScope(scope)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    return back.searchParams.get('focus')
  }

  // 同一原班组保存的是 false/0 与 false/null；草稿不得自动采用其中任一配置。
  expect(beforeOrdinary.crewDefaults).toMatchObject({ rentEnabled: { state: 'value', value: false }, rentUnitPrice: { state: 'value', value: 0 }, managementEnabled: { state: 'value', value: false }, managementUnitPrice: { state: 'null' } })
  await page.goto(configPath(ordinaryScope))
  await expect(fees()).toBeVisible()
  await page.getByRole('button', { name: '新增费用', exact: true }).click()
  await expect(row().getByLabel('启用此费用', { exact: true })).not.toBeChecked()
  await expect(row().getByLabel('费用单价', { exact: true })).toHaveValue('')
  await expect(row().getByRole('button', { name: '采用班组房补默认', exact: true })).toBeEnabled()
  await expect(row().getByRole('region', { name: '班组费用默认事实', exact: true })).toContainText('开关：已关闭')
  await expect(row().getByRole('region', { name: '班组费用默认事实', exact: true })).toContainText('单价：明确 0.00 元')
  await capture('crew-default-zero-not-adopted', row().getByRole('region', { name: '班组费用默认事实', exact: true }))
  await row().getByRole('button', { name: '移除未保存项', exact: true }).click()
  expect((await repository.aFeeConfig(query, ordinaryScope)).fees).toEqual(beforeOrdinary.fees)

  // 在普通项目另建公司代管关系；不改已经发放的独立管理簿及其工资。
  const candidate = beforeOrdinary.responsibilityOptions.find(option => option.eligible && option.cells.length > 0)
  expect(candidate, '原项目必须有服务提供的合法责任候选').toBeDefined()
  const companyNote = '九月公司代管责任：仅登记原施工范围，管理人与实际发放均不从此关系生成。此前普通工资和另一项目已发管理簿完整保留。'
  await page.getByRole('button', { name: '新增公司代管范围', exact: true }).click()
  await expect(relation().getByLabel('管理方式', { exact: true })).toHaveValue('company-managed')
  await expect(relation().getByLabel('管理人', { exact: true })).toHaveValue('')
  await relation().getByLabel('管理簿首月比例', { exact: true }).fill('80')
  await relation().getByLabel('管理关系确认依据', { exact: true }).fill(companyNote)
  await relation().getByRole('checkbox', { name: candidate!.label, exact: true }).check()
  await capture('company-managed-original-scope', relation())
  await capture('company-managed-evidence', relation().getByLabel('管理关系确认依据', { exact: true }), [390])
  await capture('company-managed-save-control', page.getByRole('button', { name: '保存管理关系', exact: true }), [390])
  await page.getByRole('button', { name: '保存管理关系', exact: true }).click()
  await expect(relation()).toHaveCount(0)
  const afterCompany = await repository.aFeeConfig(query, ordinaryScope)
  const company = afterCompany.managementBooks.find(entry => !beforeOrdinary.managementBooks.some(old => old.book.id === entry.book.id))
  expect(company?.revision).toMatchObject({ managementMode: 'company-managed', effectiveMonth: month, evidenceNote: companyNote })
  expect(company?.book.managerWorkerId).toBeNull()
  await page.getByLabel('费用请款簿', { exact: true }).selectOption(company!.book.id)
  await expect(page.getByText('当前范围为公司代管，不生成管理费单。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '生成或打开本期管理费草稿', exact: true })).toHaveCount(0)
  expect((await repository.list({ ...query, projectId: ordinary.projectId })).rows).toEqual(beforeStatements)
  expect((await repository.aFeeConfig(query, managementScope)).managementBooks).toEqual(beforeManagement.managementBooks)
  await capture('company-managed-no-statement', fees())

  await page.goto(configPath(managementScope))
  await assertScope(managementScope)
  await page.getByRole('button', { name: '新增费用', exact: true }).click()
  await expect(row().getByLabel('启用此费用', { exact: true })).not.toBeChecked()
  await expect(row().getByLabel('费用单价', { exact: true })).toHaveValue('')
  await expect(row().getByRole('button', { name: '采用班组管理费默认', exact: true })).toBeDisabled()
  await expect(row().getByRole('region', { name: '班组费用默认事实', exact: true })).toContainText('开关：已关闭')
  await expect(row().getByRole('region', { name: '班组费用默认事实', exact: true })).toContainText('单价：未填写')
  await capture('crew-default-null-not-adopted', row().getByRole('region', { name: '班组费用默认事实', exact: true }))
  const feeName = '九月管理费未保存来源核对稿'
  await row().getByLabel('费用名称', { exact: true }).fill(feeName)
  await row().getByLabel('费用单价', { exact: true }).fill('2.75')
  await row().getByLabel('费用单位', { exact: true }).fill('㎡')
  await row().getByRole('checkbox', { name: /^墙砖 ·/ }).check()
  const cell = beforeManagement.cellOptions.find(option => beforeManagement.items.some(item => item.itemId === option.itemId && item.itemName === '墙砖'))
  expect(cell).toBeDefined()
  await row().getByRole('checkbox', { name: cell!.locationLabel, exact: true }).check()
  const focus = await sourceRoundTrip(row().getByRole('link', { name: '核对户内工程量', exact: true }).first(), 'fee-config-quantity-return', managementScope)
  await expect(row()).toHaveAttribute('data-fee-input', focus!)
  await expect(row()).toBeFocused()
  await expect(row().getByLabel('费用名称', { exact: true })).toHaveValue(feeName)
  await expect(row().getByLabel('费用单价', { exact: true })).toHaveValue('2.75')
  await expect(row().getByRole('checkbox', { name: cell!.locationLabel, exact: true })).toBeChecked()
  await capture('fee-config-quantity-return-preserves-input', fees())

  await page.getByRole('button', { name: '修订当前管理范围', exact: true }).click()
  const managementNote = '九月管理范围尚未保存的核对依据。进入原户内工程量后返回，仍须保留原项目、负责人和独立管理簿。该草稿不改变七月与八月的实际发放，也不把未完工淋浴板当成完成量。末行核对仍需显示。'
  await relation().getByLabel('管理关系确认依据', { exact: true }).fill(managementNote)
  await relation().getByLabel('管理簿首月比例', { exact: true }).fill('70')
  const checkedBefore = await relation().getByRole('checkbox').evaluateAll(nodes => nodes.map(node => ({ label: node.getAttribute('aria-label'), checked: (node as HTMLInputElement).checked })))
  // 读取界面实际生成的原量链接，不自行拼造来源地址。
  const scopeLinks = await relation().getByRole('link').all()
  let quantityLink: Locator | undefined
  for (const link of scopeLinks) {
    const href = await link.getAttribute('href')
    if (href && new URL(href, page.url()).searchParams.get('payrollSourceKind') === 'quantity-unit') {
      quantityLink = link
      break
    }
  }
  expect(quantityLink, '管理范围须提供服务授权的原户内工程量入口').toBeDefined()
  await sourceRoundTrip(quantityLink!, 'management-scope-quantity-return', managementScope)
  await expect(relation().getByLabel('管理关系确认依据', { exact: true })).toHaveValue(managementNote)
  await expect(relation().getByLabel('管理簿首月比例', { exact: true })).toHaveValue('70')
  expect(await relation().getByRole('checkbox').evaluateAll(nodes => nodes.map(node => ({ label: node.getAttribute('aria-label'), checked: (node as HTMLInputElement).checked })))).toEqual(checkedBefore)
  await expect(row().getByLabel('费用名称', { exact: true })).toHaveValue(feeName)
  await expect(row().getByLabel('费用单价', { exact: true })).toHaveValue('2.75')
  await capture('management-scope-return-preserves-input', relation())
  await capture('management-scope-return-ratio', relation().getByLabel('管理簿首月比例', { exact: true }))
  await capture('management-scope-return-evidence-tail', relation().getByLabel('管理关系确认依据', { exact: true }), widths, true)
  const afterManagement = await repository.aFeeConfig(query, managementScope)
  expect(afterManagement.fees).toEqual(beforeManagement.fees)
  expect(afterManagement.managementBooks).toEqual(beforeManagement.managementBooks)
  return { month, companyBookId: company!.book.id, originalBookId: bookId, originalStatementsUnchanged: true, defaultsNotAdopted: true, unsavedInputsPreserved: true, captures }
}

/** 已发管理页或同人两簿列表的补验；仅移动视口、焦点与表格自身滚动。 */
export async function payrollFeesReadableTables(page: Page, info: TestInfo, input: { kind: 'negative' | 'same-person-list' }) {
  const measurements: Array<Record<string, unknown>> = []
  const shell = page.locator('.shell-workspace')
  async function screenshot(name: string, width: number) {
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    await expect.poll(() => shell.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: false, animations: 'disabled' })
  }
  // Range 只采集真实非空文本，避免把 td/包装元素的行框误作文字未换行证据。
  async function singleLine(cell: Locator) {
    const metric = await cell.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const rects: Array<{ left: number, right: number, top: number, bottom: number }> = []
      let node = walker.nextNode()
      while (node) {
        if (node.textContent?.trim()) {
          const range = document.createRange()
          const value = node.textContent
          range.setStart(node, value.search(/\S/))
          range.setEnd(node, value.trimEnd().length)
          for (const rect of range.getClientRects())
            rects.push({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
        }
        node = walker.nextNode()
      }
      const bounds = element.getBoundingClientRect()
      return { text: element.textContent?.trim(), rects, lineCount: new Set(rects.map(rect => Math.round(rect.top))).size, insideCell: rects.length > 0 && rects.every(rect => rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1) }
    })
    expect(metric.lineCount, JSON.stringify(metric)).toBe(1)
    expect(metric.insideCell, JSON.stringify(metric)).toBe(true)
    return metric
  }
  await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(0, { timeout: 15000 })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 960 })
    if (input.kind === 'negative') {
      await expect(page.getByRole('button', { name: '下载冻结工资表', exact: true })).toBeVisible()
      const region = page.getByRole('region', { name: '工资费用组成', exact: true }).getByRole('region', { name: '负价代付核算组成', exact: true })
      await expect(region).toHaveCount(1)
      const rows = region.locator('tbody tr')
      await expect(rows).toHaveCount(1)
      const cells = rows.first().locator('td')
      await expect(cells.nth(3)).toHaveText('¥-20.00')
      await expect(cells.nth(4)).toHaveText('¥-600.00')
      const reason = region.locator('.negative-reason')
      await expect(reason).toContainText('长事由末行须完整显示。')
      await expect(reason).toContainText('得到520。')
      await region.evaluate((node) => {
        node.scrollIntoView({ block: 'center', inline: 'nearest' })
        node.scrollLeft = 0
      })
      await reason.evaluate(node => node.scrollTop = 0)
      await region.focus()
      await expect(region).toBeFocused()
      const amountLines = [await singleLine(cells.nth(3)), await singleLine(cells.nth(4))]
      await screenshot('negative-readable-left-focus', width)
      if (width === 390) {
        await region.evaluate((node) => {
          const columns = node.querySelectorAll('tbody tr:first-child td')
          const first = columns[3]!.getBoundingClientRect()
          const last = columns[4]!.getBoundingClientRect()
          const left = node.getBoundingClientRect().left + node.clientLeft
          node.scrollLeft += (first.left + last.right) / 2 - left - node.clientWidth / 2
        })
        await expect.poll(() => region.evaluate((node) => {
          const columns = node.querySelectorAll('tbody tr:first-child td')
          const left = node.getBoundingClientRect().left + node.clientLeft
          const right = left + node.clientWidth
          return [columns[3]!, columns[4]!].every((column) => {
            const bounds = column.getBoundingClientRect()
            return bounds.left >= left - 1 && bounds.right <= right + 1
          })
        })).toBe(true)
        await screenshot('negative-readable-amount-columns', width)
        await region.evaluate(node => node.scrollLeft = 0)
        await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBe(0)
      }
      const maximum = await region.evaluate(node => node.scrollWidth - node.clientWidth)
      let keyboardLeft = 0
      if (maximum > 1) {
        await region.press('ArrowRight')
        await expect.poll(() => region.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
        keyboardLeft = await region.evaluate(node => node.scrollLeft)
      }
      await region.evaluate(node => node.scrollLeft = node.scrollWidth - node.clientWidth)
      await expect.poll(() => region.evaluate(node => Math.abs(node.scrollWidth - node.clientWidth - node.scrollLeft))).toBeLessThanOrEqual(1)
      await screenshot('negative-readable-right', width)

      // tabindex=0 的表格区下一个键盘目标就是长理由区，不给测试临时注入可聚焦属性。
      await region.focus()
      await region.press('Tab')
      await expect(reason).toBeFocused()
      const reasonMaximum = await reason.evaluate(node => node.scrollHeight - node.clientHeight)
      let keyboardTop = 0
      if (reasonMaximum > 1) {
        await reason.press('PageDown')
        await expect.poll(() => reason.evaluate(node => node.scrollTop)).toBeGreaterThan(0)
        keyboardTop = await reason.evaluate(node => node.scrollTop)
      }
      async function captureTail(paragraph: number, name: string) {
        const tail = await reason.evaluate((node, index) => {
          const paragraph = node.querySelectorAll('p')[index]!
          const text = paragraph.firstChild!
          const range = document.createRange()
          range.setStart(text, Math.max(0, (text.textContent?.length ?? 0) - 8))
          range.setEnd(text, text.textContent?.length ?? 0)
          const before = range.getBoundingClientRect()
          const box = node.getBoundingClientRect()
          node.scrollTop += before.bottom - box.bottom + 8
          const rect = range.getBoundingClientRect()
          return { text: range.toString(), top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, visible: rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1 && rect.left >= box.left - 1 && rect.right <= box.right + 1 && rect.top >= 0 && rect.bottom <= innerHeight, scrollTop: node.scrollTop, maximum: node.scrollHeight - node.clientHeight }
        }, paragraph)
        expect(tail.visible, JSON.stringify(tail)).toBe(true)
        await expect(reason).toBeFocused()
        await screenshot(name, width)
        return tail
      }
      const reasonTail = await captureTail(0, 'negative-readable-reason-tail')
      const evidenceTail = await captureTail(1, 'negative-readable-evidence-tail')
      measurements.push({ width, amountLines, maximum, keyboardLeft, reasonMaximum, keyboardTop, reasonTail, evidenceTail })
    }
    else {
      const table = page.getByRole('region', { name: '工资只读台账', exact: true }).locator('[data-ui="kit-table"]')
      const main = table.locator('.vxe-table--main-wrapper')
      const body = main.locator('.body--wrapper .vxe-table--body-inner-wrapper')
      const rows = body.locator('tbody .vxe-body--row')
      await expect(rows).toHaveCount(2)
      const actualHeader = main.locator('.vxe-header--column').filter({ hasText: '实际发放' })
      await expect(actualHeader).toHaveCount(1)
      const columnId = await actualHeader.getAttribute('colid')
      expect(columnId).toBeTruthy()
      const actualCells = rows.locator(`td[colid="${columnId}"]`)
      await expect(actualCells).toHaveCount(2)
      const texts = (await actualCells.allTextContents()).map(value => value.trim()).sort()
      expect(texts).toEqual(['¥1,000.00', '¥200.00'])
      await table.evaluate((node) => {
        const workspace = node.closest<HTMLElement>('.shell-workspace')!
        workspace.scrollTop += node.getBoundingClientRect().top - workspace.getBoundingClientRect().top - 24
      })
      await body.evaluate(node => node.scrollLeft = 0)
      const visibleRows = await rows.evaluateAll(nodes => nodes.map((node) => {
        const rect = node.getBoundingClientRect()
        const workspace = node.closest('.shell-workspace')!.getBoundingClientRect()
        return { text: node.textContent, top: rect.top, bottom: rect.bottom, withinWorkspace: rect.top >= workspace.top && rect.bottom <= workspace.bottom && rect.top >= 0 && rect.bottom <= innerHeight }
      }))
      expect(visibleRows.every(row => row.withinWorkspace), JSON.stringify(visibleRows)).toBe(true)
      await screenshot('same-person-readable-left-two-rows', width)
      // 按实际表头 colid 找列；仅移动 vxe 实体横滚，不能靠滚整个页面或裁掉固定月列。
      await body.evaluate((node, id) => {
        const cell = [...node.querySelectorAll<HTMLElement>('tbody td')].find(cell => cell.getAttribute('colid') === id)!
        const bounds = node.getBoundingClientRect()
        const fixed = node.closest('[data-ui="kit-table"]')!.querySelector('.vxe-table--fixed-left-wrapper')?.getBoundingClientRect().width ?? 0
        const target = cell.getBoundingClientRect()
        node.scrollLeft += target.left - bounds.left - fixed - Math.max(0, (bounds.width - fixed - target.width) / 2)
      }, columnId)
      await expect.poll(() => body.evaluate(node => node.scrollLeft)).toBeGreaterThan(0)
      await expect.poll(() => actualCells.evaluateAll(nodes => nodes.every((node) => {
        const body = node.closest('.vxe-table--body-inner-wrapper')!
        const viewport = body.getBoundingClientRect()
        const fixed = body.closest('[data-ui="kit-table"]')!.querySelector('.vxe-table--fixed-left-wrapper')?.getBoundingClientRect().width ?? 0
        const rect = node.getBoundingClientRect()
        return rect.left >= viewport.left + fixed - 1 && rect.right <= viewport.right + 1
      }))).toBe(true)
      const amounts = [await singleLine(actualCells.nth(0)), await singleLine(actualCells.nth(1))]
      await screenshot('same-person-readable-actual-two-rows', width)
      measurements.push({ width, visibleRows, amounts, horizontal: await body.evaluate(node => ({ left: node.scrollLeft, maximum: node.scrollWidth - node.clientWidth })) })
    }
  }
  await writeFile(info.outputPath(`${input.kind}-readable-measurements.json`), JSON.stringify(measurements, null, 2))
  await page.setViewportSize({ width: 1440, height: 960 })
  return { kind: input.kind, screenshotScope: 'current-shell-viewport', measurements }
}
