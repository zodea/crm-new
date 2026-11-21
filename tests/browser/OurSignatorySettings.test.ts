import type { OurSignatoryRecord } from '~/lib/our-signatory/contract'
import { createPinia } from 'pinia'
import { afterEach, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-vue'
import { page, userEvent } from 'vitest/browser'
import { computed, defineComponent, h, nextTick, onMounted, useTemplateRef, watch } from 'vue'
import VxeUI from 'vxe-pc-ui'
import VxeTable from 'vxe-table'
import SelectFilter from '~/components/ui/SelectFilter.vue'
import TablePager from '~/components/ui/TablePager.vue'
import TreeNav from '~/components/ui/TreeNav.vue'
import { attachReadMeta } from '~/lib/read-model/meta'
import OurSignatorySettingsScreen from '../../app/pages/settings/our-signatories/_components/OurSignatorySettingsScreen.vue'
import 'vxe-pc-ui/lib/style.css'
import 'vxe-table/lib/style.css'
import '~/assets/css/vxe-theme.css'

const asOf = '2026-10-04T00:00:00.000Z'
const emptyText = '尚未录入主体。按真实文书核实后新增，再在合同中明确选择。'

function record(id: string, name: string, status: 'active' | 'inactive', taxNo: string | null): OurSignatoryRecord {
  const draft = { name, status, taxNo, registeredAddress: null, legalRepresentative: null, verificationNote: '真实文书核实' }
  return {
    id,
    draft,
    version: '1',
    createdAt: asOf,
    updatedAt: asOf,
    history: [{ id: `${id}-v1`, version: '1', draft, actorId: 'test-owner', commandId: null, occurredAt: asOf }],
  }
}

const records = [
  record('current-company', '正式签约公司', 'active', 'CURRENT-TAX'),
  record('archived-company', '历史签约公司', 'inactive', null),
]

function listing(canWrite: boolean, rows = records) {
  return attachReadMeta({ records: rows }, {
    schemaVersion: 'our-signatory-read-v2',
    workspaceId: 'test-workspace',
    actorId: 'test-owner',
    dataOrigin: 'real',
    asOf,
    sourceVersion: 'test-generation',
    sources: [{ key: 'our-signatories', state: 'readable', sourceVersion: 'test-generation', asOf }],
    authorizedScope: { coverage: 'complete', fingerprint: 'test-scope' },
    capabilities: ['our-signatory:read', ...(canWrite ? ['our-signatory:write'] : [])],
  })
}

function renderDirectory(fetch: (url: string) => Promise<unknown>) {
  vi.stubGlobal('$fetch', fetch)
  vi.stubGlobal('useTabTitle', vi.fn())
  for (const [name, api] of Object.entries({ computed, nextTick, onMounted, useTemplateRef, watch }))
    vi.stubGlobal(name, api)
  const navigate = vi.fn()
  const NuxtLink = defineComponent({
    props: { to: { type: String, required: true } },
    setup: (props, { slots }) => () => h('a', {
      href: props.to,
      onClick: (event: MouseEvent) => {
        event.preventDefault()
        navigate(props.to)
      },
    }, slots.default?.()),
  })
  return {
    navigate,
    mounted: render(OurSignatorySettingsScreen, { global: { plugins: [createPinia(), VxeUI, VxeTable], components: { NuxtLink, SelectFilter, TablePager, TreeNav } } }),
  }
}

afterEach(() => vi.unstubAllGlobals())

it('我方主体目录保留真实公司、状态和版本，操作可键盘到达且只有表格内横滚', async () => {
  const fetch = vi.fn().mockResolvedValue(listing(true))
  const { navigate, mounted } = renderDirectory(fetch)
  await mounted
  const directory = page.getByRole('region', { name: '签约主体目录' })
  await expect.element(directory).toHaveTextContent('正式签约公司')
  await expect.element(directory).toHaveTextContent('CURRENT-TAX')
  await expect.element(directory.getByText('可选择', { exact: true })).toHaveAttribute('data-tone', 'ok')
  await expect.element(directory).toHaveTextContent('历史签约公司')
  await expect.element(directory).toHaveTextContent('未核实')
  await expect.element(directory.getByText('已停用', { exact: true })).toHaveAttribute('data-tone', 'neutral')
  await expect.element(directory).toHaveTextContent('版本')
  expect(fetch).toHaveBeenCalledWith('/api/read/our-signatories', { retry: 0 })

  const create = page.getByRole('link', { name: '新增主体', exact: true })
  const edit = directory.getByRole('link', { name: '编辑正式签约公司', exact: true })
  await expect.element(create).toHaveAttribute('href', '/settings/our-signatories/form')
  await expect.element(edit).toHaveAttribute('href', '/settings/our-signatories/form/current-company')
  create.element().focus()
  // When the table overflows, Chromium lets keyboard users focus and scroll it first.
  for (let step = 0; step < 6 && document.activeElement !== edit.element(); step++)
    await userEvent.tab()
  await expect.element(edit).toHaveFocus()
  await userEvent.keyboard('{Enter}')
  expect(navigate).toHaveBeenCalledWith('/settings/our-signatories/form/current-company')

  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth)
  if (window.innerWidth < 500) {
    const scroll = directory.element().querySelector<HTMLElement>('.vxe-table--scroll-x-handle')!
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth)
    scroll.scrollLeft = scroll.scrollWidth
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0)
  }
})

it('冷读失败可键盘重试，只读结果保留公司而隐藏新增与编辑', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValueOnce(listing(false))
  const { mounted } = renderDirectory(fetch)
  await mounted
  const retry = page.getByRole('button', { name: '重新读取', exact: true })
  await expect.element(retry).toBeVisible()
  await expect.element(page.getByRole('status')).toHaveTextContent('我方主体目录暂不可用')
  await expect.element(page.getByText(emptyText, { exact: true })).not.toBeInTheDocument()
  retry.element().focus()
  await userEvent.keyboard('{Enter}')
  const directory = page.getByRole('region', { name: '签约主体目录' })
  await expect.element(directory).toHaveTextContent('正式签约公司')
  await expect.element(page.getByRole('link', { name: '新增主体' })).not.toBeInTheDocument()
  await expect.element(directory.getByRole('link', { name: /编辑/ })).not.toBeInTheDocument()
  expect(fetch).toHaveBeenCalledTimes(2)
})

it('目录成功读取为空才显示真实空态并保留授权新建入口', async () => {
  const pending = Promise.withResolvers<unknown>()
  const { mounted } = renderDirectory(() => pending.promise)
  await mounted
  await expect.element(page.getByRole('status')).toHaveTextContent('正在读取我方主体目录')
  await expect.element(page.getByText(emptyText, { exact: true })).not.toBeInTheDocument()
  pending.resolve(listing(true, []))
  await expect.element(page.getByRole('status', { name: emptyText, exact: true })).toBeVisible()
  await expect.element(page.getByRole('link', { name: '新增主体', exact: true })).toBeVisible()
})
