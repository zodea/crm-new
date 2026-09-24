import { Buffer } from 'node:buffer'
import { mkdir } from 'node:fs/promises'
import process from 'node:process'
import { expect, test } from '@playwright/test'
import { expectEscapeReturnsFocus, expectLocalHorizontalScroll, expectNoPageOverflow, expectOverlayAboveShell, RESPONSIVE_WIDTHS } from './helpers/responsive'

test.describe('AX04 辅助合同只读与编辑', () => {
  test.beforeEach(async ({ page }, info) => {
    const session = Buffer.from(info.testId).toString('base64url')
    await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': session })
    for (const domain of ['projects', 'suppliers', 'auxiliary-contracts']) {
      const response = await page.request.post(`/api/testing/${domain}/reset`, { headers: { 'x-ruihang-test-reset': '1', 'x-ruihang-test-session': session }, data: { scenario: 'ready' } })
      expect(response.ok(), await response.text()).toBe(true)
    }
  })
  test('两类列表进入只读详情，显式编辑保存，刷新及来源返回', async ({ page }) => {
    test.setTimeout(180000)
    for (const [kind, name] of [['other-expense', '验收检测服务合同'], ['company-expense', '办公室租赁合同']]) {
      await page.goto(`/contract/${kind}?search=${encodeURIComponent(name!)}&pageSize=10`)
      await page.getByRole('link', { name, exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
      await expect(page.getByLabel('合同名称 *')).toHaveCount(0)
      const detailURL = page.url()
      await page.getByRole('button', { name: '编辑合同', exact: true }).click()
      await expect(page).toHaveURL(/\/form\//)
      await page.getByLabel('合同名称 *').fill(`${name}（已修改）`)
      if (kind === 'company-expense')
        await expect(page.getByRole('combobox', { name: '检索项目' })).toHaveCount(0)
      await page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toContainText(`${name}（已修改）`)
      await page.reload()
      await expect(page.getByTestId('auxiliary-detail')).toContainText(`${name}（已修改）`)
      for (const width of RESPONSIVE_WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        await expectNoPageOverflow(page, `${kind} 详情 ${width}`)
      }
      await page.getByRole('button', { name: '返回来源', exact: true }).click()
      await expect(page.getByPlaceholder('搜索合同名称 / 编号 / 对方单位')).toHaveValue(name!)
      await page.goto(detailURL)
      await page.getByRole('button', { name: '收票登记', exact: true }).click()
      await expect(page.getByText('暂无收票记录', { exact: true })).toBeVisible()
    }
  })
  test('真实项目和分供方往返保持稳定关系及来源位置', async ({ page }) => {
    await page.goto('/contract/other-expense')
    await page.getByRole('link', { name: '验收检测服务合同', exact: true }).click()
    for (const [name, path] of [['中央正式施工项目', '/project/project-real-320'], ['中央正式劳务分供方', '/base/supplier/supplier-real-327']]) {
      await page.getByTestId('auxiliary-detail').getByRole('link', { name, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(path!))
      await page.getByTestId('auxiliary-journey').getByRole('link', { name: '查看其他支出合同' }).click()
      await expect(page.getByTestId('auxiliary-list')).toContainText('限定')
      await page.getByRole('link', { name: '返回来源', exact: true }).click()
      await expect(page.getByTestId('auxiliary-journey').getByRole('link')).toBeFocused()
      await page.getByRole('link', { name: /返回其他支出合同|返回来源详情/ }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
    }
  })
  test('第二页筛选结果经详情往返保留页码与行焦点', async ({ page }) => {
    const context = await (await page.request.get('/api/read/auxiliary-contracts/context')).json()
    for (let index = 1; index <= 12; index++) {
      const response = await page.request.post('/api/commands/auxiliary-contracts', {
        data: {
          workspaceId: context.workspaceId,
          actorId: context.actorId,
          requiredCapability: 'auxiliary-contract:write',
          commandId: `pagination-${index}`,
          baseVersion: null,
          action: 'save',
          draft: { kind: 'company_expense', name: `分页验收合同${index}`, category: '房租', counterparty: '分页出租单位', signDate: '2026-09-06', amount: 100, paymentCycle: '一次性' },
          attachments: { add: [], removeIds: [], restoreIds: [] },
        },
      })
      expect(response.ok(), await response.text()).toBe(true)
    }
    await page.goto('/contract/company-expense?search=分页验收&page=2&pageSize=10')
    const row = page.getByTestId('auxiliary-list').getByRole('link', { name: /^分页验收合同/ }).first()
    const name = (await row.textContent())!.trim()
    await row.click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText(name)
    await page.getByRole('button', { name: '返回来源', exact: true }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page.getByPlaceholder('搜索合同名称 / 编号 / 对方单位')).toHaveValue('分页验收')
    await expect(page.getByTestId('auxiliary-list').getByRole('link', { name, exact: true })).toBeFocused()
    await expect(page.getByText('当前筛选 · 正式合同 12 份')).toBeVisible()
  })
  test('从项目及分供方列表起步的完整来源链可以逐级返回', async ({ page }) => {
    for (const [list, name, backLabel] of [
      ['/project', '中央正式施工项目', '返回项目列表'],
      ['/base/supplier', '中央正式劳务分供方', '返回分供方列表'],
    ]) {
      await page.goto(list!)
      await page.getByRole('link', { name, exact: true }).click()
      await expect(page.getByTestId('auxiliary-journey')).toBeVisible()
      const source = new URL(page.url()).searchParams.get('returnTo')
      expect(source).toBeTruthy()
      await page.getByTestId('auxiliary-journey').getByRole('link', { name: '查看其他支出合同' }).click()
      await page.getByRole('link', { name: '验收检测服务合同', exact: true }).click()
      await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
      await page.getByRole('button', { name: '返回来源', exact: true }).click()
      await page.getByRole('link', { name: '返回来源', exact: true }).click()
      await expect(page.getByTestId('auxiliary-journey').getByRole('link')).toBeFocused()
      await expect.poll(() => new URL(page.url()).searchParams.get('returnTo')).toBe(source)
      await page.getByRole('link', { name: backLabel, exact: true }).click()
      await expect.poll(() => new URL(page.url()).pathname).toBe(list)
      await expect(page.getByRole('link', { name, exact: true })).toBeVisible()
    }
  })
  test('读取失败可重试，无权限、错误身份与筛选空态不混淆', async ({ page }) => {
    const readURL = '**/api/read/auxiliary-contracts?**'
    await page.route(readURL, route => route.abort('failed'))
    await page.goto('/contract/company-expense')
    await expect(page.getByText('合同服务暂时不可用，请重试', { exact: true })).toBeVisible()
    await expect(page.getByText('暂无公司支出合同', { exact: true })).toHaveCount(0)
    await page.unroute(readURL)
    await page.getByRole('button', { name: '重新加载', exact: true }).click()
    await page.getByRole('link', { name: '办公室租赁合同', exact: true }).click()
    await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
    const url = page.url()
    await page.goto(url.replace('/company-expense/', '/other-expense/'))
    await expect(page.getByText('合同类型或数据来源不匹配', { exact: true })).toBeVisible()
    await page.goto('/contract/company-expense/unknown-id?origin=real')
    await expect(page.getByText('合同不存在或已删除', { exact: true })).toBeVisible()
    await page.goto('/contract/company-expense?search=无匹配合同')
    await expect(page.getByRole('status', { name: '没有符合条件的合同' })).toBeVisible()
    await page.getByRole('button', { name: '清除筛选', exact: true }).first().click()
    await expect(page.getByRole('link', { name: '办公室租赁合同', exact: true })).toBeVisible()
    await page.route('**/api/read/auxiliary-contracts/**', route => route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ data: { code: 'forbidden', message: '无合同查看权限', retryable: false, fieldErrors: {}, traceId: null } }) }))
    await page.goto(url)
    await expect(page.getByText('无合同查看权限', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '编辑合同' })).toHaveCount(0)
  })
  test('新建公司合同保存响应丢失后重试同一命令，附件及审计随中央事实回读', async ({ page }) => {
    await page.goto('/contract/company-expense/form')
    await page.getByLabel('合同名称 *').fill('重试验收合同')
    await page.getByLabel('对方单位 *').fill('验收出租单位')
    await page.getByLabel('签订日期 *').fill('2026-09-06')
    await page.getByLabel('合同金额 *').fill('1060')
    await page.locator('input[type=file]').setInputFiles({ name: '验收合同说明.txt', mimeType: 'text/plain', buffer: Buffer.from('仅验收用附件元数据') })
    const commands: string[] = []
    let loseResponse = true
    await page.route('**/api/commands/auxiliary-contracts', async (route) => {
      commands.push(route.request().postDataJSON().commandId)
      const response = await route.fetch()
      if (loseResponse) {
        loseResponse = false
        await route.abort('failed')
      }
      else {
        await route.fulfill({ response })
      }
    })
    const save = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '保存', exact: true })
    await save.click()
    await expect(page.getByRole('alert').filter({ hasText: '当前输入已保留' })).toBeVisible()
    await expect(page.getByLabel('合同名称 *')).toHaveValue('重试验收合同')
    await save.click()
    await expect(page.getByTestId('auxiliary-detail')).toContainText('重试验收合同')
    await expect(page.getByTestId('auxiliary-detail')).toContainText('验收合同说明.txt')
    expect(commands).toHaveLength(2)
    expect(commands[0]).toBe(commands[1])
    await page.goto('/contract/company-expense?search=重试验收合同')
    await expect(page.getByRole('link', { name: '重试验收合同', exact: true })).toHaveCount(1)
  })
  test('四档实际视口覆盖列表详情表单、局部滚动、菜单与离开确认', async ({ page }) => {
    test.setTimeout(180000)
    const evidence = 'docs/design/evidence/issue-330'
    if (process.env.RUIHANG_CAPTURE_EVIDENCE === '1')
      await mkdir(evidence, { recursive: true })
    for (const [kind, name] of [['other-expense', '验收检测服务合同'], ['company-expense', '办公室租赁合同']] as const) {
      for (const width of RESPONSIVE_WIDTHS) {
        const capture = async (state: string) => {
          await expectNoPageOverflow(page, `${kind} ${state} ${width}`)
          if (process.env.RUIHANG_CAPTURE_EVIDENCE === '1')
            await page.screenshot({ path: `${evidence}/${kind}-${state}-${width}.png` })
        }
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/contract/${kind}`)
        const link = page.getByRole('link', { name, exact: true })
        await expect(link).toBeVisible()
        await capture('list')
        await expectLocalHorizontalScroll(page.locator('[data-ui="kit-table"] .vxe-table--scroll-x-handle').first(), `${kind} 列表`)
        const menuTrigger = page.getByRole('button', { name: `${name}操作`, exact: true })
        await menuTrigger.focus()
        await page.keyboard.press('Enter')
        await expectEscapeReturnsFocus(page, page.getByRole('menu'), menuTrigger, '行操作菜单')
        await link.click()
        await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
        await capture('detail')
        await page.getByRole('button', { name: '收票登记', exact: true }).click()
        if (width === 390)
          await expectLocalHorizontalScroll(page.getByRole('region', { name: '合同关联事实表' }), '关联事实表')
        await page.getByRole('button', { name: '编辑合同', exact: true }).click()
        await expect(page.getByLabel('合同名称 *')).toHaveValue(name)
        if (kind === 'other-expense') {
          await expect(page.getByRole('combobox', { name: '检索项目' })).toHaveValue('中央正式施工项目')
          await expect(page.getByRole('combobox', { name: '检索分供方' })).toHaveValue('中央正式劳务分供方')
        }
        await capture('form')
        await page.getByLabel('合同名称 *').fill(`${name}（未保存）`)
        const cancel = page.getByRole('group', { name: '表单操作' }).getByRole('button', { name: '取消', exact: true })
        await cancel.click()
        const dialog = page.getByRole('dialog', { name: '放弃修改' })
        await expectOverlayAboveShell(dialog, '离开确认')
        await expectEscapeReturnsFocus(page, dialog, cancel, '离开确认')
        await expect(page.getByLabel('合同名称 *')).toHaveValue(`${name}（未保存）`)
        await cancel.click()
        await page.getByRole('dialog').getByRole('button', { name: '放弃修改', exact: true }).click()
        await expect(page.getByTestId('auxiliary-detail')).toBeVisible()
        await expect(page.getByRole('button', { name: '收票登记', exact: true })).toHaveAttribute('aria-current', 'page')
      }
    }
  })
})
