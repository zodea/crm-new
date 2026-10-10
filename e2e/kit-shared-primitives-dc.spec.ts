import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'

const dcRoot = new URL('../DC重构设计源码/', import.meta.url)
const dsRoot = new URL('_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d/', dcRoot)

async function inlineStyles(url: URL): Promise<string> {
  const source = await readFile(url, 'utf8')
  const imports = [...source.matchAll(/@import\s+"([^"]+\.css)";/g)]
  const nested = await Promise.all(imports.map(match => inlineStyles(new URL(match[1], url))))
  return [...nested, source.replace(/@import\s+"[^"]+\.css";/g, '')].join('\n')
}

for (const width of [390, 768, 1024, 1280, 1440]) {
  test(`DC 共享指标与函数式行菜单在 ${width}px 保全键盘、边缘与原动作`, async ({ page }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: 900 })
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
    await trigger.focus()
    await page.keyboard.press('ArrowDown')
    const menu = page.getByRole('menu', { name: '原版本操作' })
    await expect(menu).toBeVisible()
    await expect(page.getByRole('menuitem', { name: '查看原版本' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('menuitem', { name: '删除' })).toBeFocused()
    await page.keyboard.press('Home')
    await expect(page.getByRole('menuitem', { name: '查看原版本' })).toBeFocused()
    const box = await menu.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(900)
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
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    expect(errors).toEqual([])
  })
}
