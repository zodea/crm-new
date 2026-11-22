import type { Locator } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

async function expectColumnWidthsAligned(table: Locator) {
  await expect.poll(() => table.evaluate((root) => {
    const differences: number[] = []
    for (const region of root.querySelectorAll('.vxe-table--main-wrapper, .vxe-table--fixed-left-wrapper, .vxe-table--fixed-right-wrapper')) {
      if (!region.getBoundingClientRect().width)
        continue
      const row = region.querySelector('.vxe-body--row')
      for (const head of region.querySelectorAll('.vxe-header--column[colid]:not(.fixed--hidden)')) {
        const width = head.getBoundingClientRect().width
        if (!width)
          continue
        const body = row?.querySelector(`.vxe-body--column[colid="${CSS.escape(head.getAttribute('colid')!)}"]`)
        if (!body)
          return Number.POSITIVE_INFINITY
        differences.push(Math.abs(width - body.getBoundingClientRect().width))
      }
    }
    return differences.length ? Math.max(...differences) : Number.POSITIVE_INFINITY
  }), '同一列的表头和正文宽度差不超过 1.5px').toBeLessThanOrEqual(1.5)
}

async function expectDocumentDoesNotOverflow(page: import('@playwright/test').Page) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)
}

test.describe('KitTable 公共表格规格', () => {
  test('普通列仅从右缘拖拽，固定操作列没有含混手柄', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/dev/kit-table')
    await page.waitForLoadState('networkidle')

    const table = page.locator('[data-ui="kit-table"]').first()
    await expect(table).toBeVisible()

    const header = table.locator('.vxe-header--column').filter({ hasText: '项目编号' }).first()
    const handle = header.locator('.vxe-cell--col-resizable')
    await expect(handle).toBeVisible()
    await expect(handle).toHaveCSS('cursor', 'col-resize')
    const headerBounds = (await header.boundingBox())!
    const handleBounds = (await handle.boundingBox())!
    const rightEdge = headerBounds.x + headerBounds.width
    expect(handleBounds.width).toBeGreaterThan(0)
    expect(handleBounds.width).toBeLessThanOrEqual(12)
    expect(handleBounds.x).toBeLessThan(rightEdge)
    expect(handleBounds.x + handleBounds.width).toBeGreaterThanOrEqual(rightEdge)

    const actionColumn = table.locator('.vxe-table--fixed-right-wrapper')
    await expect(actionColumn).toBeVisible()
    await expect(actionColumn.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    expect((await actionColumn.boundingBox())?.width).toBeLessThanOrEqual(114)

    const disabledHeader = table.locator('.vxe-header--column').filter({ hasText: '计划开工' }).first()
    await expect(disabledHeader.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    await expectDocumentDoesNotOverflow(page)
  })

  test('双击普通列表头手柄恢复自适应', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/dev/kit-table')
    await page.waitForLoadState('networkidle')

    const table = page.locator('[data-ui="kit-table"]').first()
    const header = table.locator('.vxe-header--column').filter({ hasText: '项目编号' }).first()
    const handle = header.locator('.vxe-cell--col-resizable')
    const before = (await header.boundingBox())!.width
    const handleBox = (await handle.boundingBox())!
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(handleBox.x + 72, handleBox.y + handleBox.height / 2)
    await page.mouse.up()
    expect((await header.boundingBox())!.width).toBeGreaterThan(before + 40)

    await handle.dblclick()
    expect((await header.boundingBox())!.width).toBeLessThan(before + 10)
    await expectColumnWidthsAligned(table)
  })

  // 当前施工合同专属列表不再提供旧本地操作列；通用编辑/删除项目由 RowActionMenu.test.ts 验证。
  test('分供方只读列表用紧凑省略号菜单收纳当前可用动作', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'true'))
    await page.clock.install({ time: new Date('2026-10-03T04:00:00.000Z') })
    await page.goto('/base/supplier?search=穗建五金')
    await page.waitForLoadState('networkidle')

    const table = page.locator('[data-ui="kit-table"]').first()
    const headerRow = table.locator('.vxe-table--main-wrapper .vxe-header--row').first()
    const bodyRow = table.locator('.vxe-table--main-wrapper .vxe-body--row').first()
    await expect(headerRow).toHaveCSS('height', '32px')
    await expect(bodyRow).toHaveCSS('height', '32px')
    await page.getByRole('button', { name: '列设置', exact: true }).click()
    const settings = page.getByRole('dialog', { name: '列设置', exact: true })
    const comfortable = settings.getByRole('checkbox', { name: '舒适行高', exact: true })
    await comfortable.check()
    await expect(headerRow).toHaveCSS('height', '44px')
    await expect(bodyRow).toHaveCSS('height', '44px')
    await comfortable.uncheck()
    await expect(headerRow).toHaveCSS('height', '32px')
    await expect(bodyRow).toHaveCSS('height', '32px')
    await page.keyboard.press('Escape')

    const actionColumn = table.locator('.vxe-table--fixed-right-wrapper').first()
    await expect(actionColumn).toBeVisible()
    const width = (await actionColumn.boundingBox())!.width
    expect(width).toBeGreaterThanOrEqual(32)
    expect(width).toBeLessThanOrEqual(114)
    const trigger = actionColumn.locator('[data-ui="row-action-menu-trigger"]').first()
    await expect(trigger).toBeVisible()
    const actionLabel = await trigger.getAttribute('aria-label')
    expect(actionLabel).toBeTruthy()
    const initialUrl = page.url()
    await trigger.focus()
    await trigger.press('Enter')
    const menu = page.getByRole('menu', { name: actionLabel! })
    await expect(menu.getByRole('menuitem', { name: '查看详情' })).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['查看详情'])
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(page.url()).toBe(initialUrl)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(actionColumn.locator('.vxe-cell--col-resizable')).toHaveCount(0)
    await expectColumnWidthsAligned(table)
    await expectDocumentDoesNotOverflow(page)
  })

  test('宽表在各宽度只在自身容器横滚', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/kit-table')
    await page.waitForLoadState('networkidle')

    const table = page.locator('[data-ui="kit-table"]').first()
    const vxeTable = table.locator('.vxe-table').first()
    const scrollX = table.locator('.vxe-table--scroll-x-wrapper').first()
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 900 },
      { width: 1024, height: 900 },
      { width: 1280, height: 900 },
      { width: 1440, height: 1000 },
    ] as const) {
      await page.setViewportSize(viewport)
      await expect(scrollX).toBeVisible()
      await expect.poll(async () => {
        const [tableBox, scrollBox] = await Promise.all([vxeTable.boundingBox(), scrollX.boundingBox()])
        return scrollBox!.x >= tableBox!.x && scrollBox!.x + scrollBox!.width <= tableBox!.x + tableBox!.width + 1
      }, `${viewport.width}px 横滚条应位于表格容器内`).toBe(true)
      await expectColumnWidthsAligned(table)
      await expectDocumentDoesNotOverflow(page)
    }
  })
})

const dcRoot = new URL('../DC重构设计源码/', import.meta.url)
const dsRoot = new URL('_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/', dcRoot)

async function inlineStyles(url: URL): Promise<string> {
  const source = await readFile(url, 'utf8')
  const imports = [...source.matchAll(/@import\s+"([^"]+\.css)";/g)]
  const nested = await Promise.all(imports.map((match) => {
    const path = match[1]
    if (!path)
      throw new Error('设计稿样式引用路径缺失')
    return inlineStyles(new URL(path, url))
  }))
  return [...nested, source.replace(/@import\s+"[^"]+\.css";/g, '')].join('\n')
}

test('DC 共享指标与函数式行菜单保全键盘与原动作，各宽度菜单不越出视口', async ({ page }) => {
  test.setTimeout(60_000)
  const widths = [390, 768, 1024, 1280, 1440] as const
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent('<!doctype html><html><body style="margin:0;padding:12px"><div id="fixture"></div></body></html>')
  // 消费现行设计稿锁定的 React 版本和真实公共源码，不加载私有 data.local.js。
  const support = await readFile(new URL('support.js', dcRoot), 'utf8')
  for (const key of ['REACT_URL', 'REACT_DOM_URL']) {
    const url = support.match(new RegExp(`var ${key} = "([^"]+)"`))?.[1]
    if (!url || !url.startsWith('https://unpkg.com/'))
      throw new Error(`设计稿锁定运行时 ${key} 未找到`)
    await page.addScriptTag({ url })
  }
  await page.addScriptTag({ url: 'https://unpkg.com/lucide@1.27.0' })
  await page.addStyleTag({ content: await inlineStyles(new URL('styles.css', dsRoot)) })
  await page.addScriptTag({ content: await readFile(new URL('_ds_bundle.js', dsRoot), 'utf8') })
  await page.addScriptTag({ content: await readFile(new URL('kit/KitAtoms.jsx', dcRoot), 'utf8') })
  await page.addScriptTag({ content: `
    const dcH = React.createElement;
    function PrimitiveFixture() {
      const [extra, setExtra] = React.useState(false);
      const [result, setResult] = React.useState('尚未选择');
      const KA = window.KitAtoms;
      return dcH('main', null,
        dcH('button', { type:'button', onClick:()=>setExtra(v=>!v) }, '切换条件菜单'),
        extra && KA.RowActionMenu({ label:'条件行操作', items:[{key:'extra',label:'条件动作',onSelect:()=>setResult('条件动作')}] }),
        KA.SectionHeader({children:'原工资与预算指标'}),
        KA.MetricGrid({cols:3,children:[
          KA.Metric({label:'工资实际净额',value:'¥0.00',formula:'原实发加真实补退，不重复成员分配。'}),
          KA.Metric({label:'历史工资',value:'尚不能确认',status:'待核对',missingSources:'原件未接通'}),
          KA.Metric({label:'原退款',value:'¥-500.00',tone:'danger'})
        ]}),
        dcH(window.DesignSystem_e3d871.StatCard,{label:'原工资单',value:'12份',clickable:true,onClick:()=>setResult('筛选原工资')}),
        dcH('output', {'aria-label':'原动作结果'}, result),
        dcH('div', {style:{position:'fixed',right:12,bottom:12,width:180,height:40,overflow:'hidden'}},
          KA.RowActionMenu({label:'原版本操作',items:[
            {key:'blocked',label:'编辑冻结历史',disabled:true},
            {key:'original',label:'查看原版本',onSelect:()=>setResult('查看原版本')},
            {key:'danger',label:'删除',danger:true,onSelect:()=>setResult('删除')}
          ]})),
        dcH('div', {style:{position:'fixed',left:12,bottom:12}}, KA.RowActionMenu({label:'空行操作',items:[]}))
      );
    }
    ReactDOM.createRoot(document.getElementById('fixture')).render(dcH(PrimitiveFixture));
  ` })
  const toggle = page.getByRole('button', { name: '切换条件菜单' })
  await toggle.click()
  await expect(page.getByRole('button', { name: '条件行操作' })).toBeVisible()
  await toggle.click()
  await expect(page.getByRole('button', { name: '条件行操作' })).toBeHidden()
  await expect(page.getByRole('heading', { name: '原工资与预算指标' })).toBeVisible()
  await expect(page.getByRole('group', { name: '工资实际净额' })).toContainText('¥0.00')
  await expect(page.getByRole('group', { name: '历史工资' })).toContainText('原件未接通')
  await page.getByRole('button', { name: '原工资单 12份' }).click()
  await expect(page.getByLabel('原动作结果')).toHaveText('筛选原工资')
  const trigger = page.getByRole('button', { name: '原版本操作' })
  const menu = page.getByRole('menu', { name: '原版本操作' })
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    await expect(menu).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '查看原版本' })).toBeFocused()
    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x, `${width}px 菜单左缘`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${width}px 菜单右缘`).toBeLessThanOrEqual(width)
    expect(box!.y, `${width}px 菜单上缘`).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height, `${width}px 菜单下缘`).toBeLessThanOrEqual(900)
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    await expect(trigger).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  }
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  await expect(menu).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '查看原版本' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem', { name: '删除' })).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByRole('menuitem', { name: '查看原版本' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
  await expect(page.getByLabel('原动作结果')).toHaveText('查看原版本')
  await trigger.click()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await page.getByRole('button', { name: '空行操作' }).click()
  await expect(page.getByText('无可用操作')).toBeVisible()
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  expect(errors).toEqual([])
})
