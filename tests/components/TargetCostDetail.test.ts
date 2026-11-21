import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import TargetCostItemTable from '~/components/target-cost/TargetCostItemTable.vue'
import { useTargetCostFiles } from '~/composables/useTargetCostFiles'

describe('目标成本详情', () => {
  const KitTable = defineComponent({
    props: ['data', 'empty'],
    template: `
    <div data-testid="kit-table">
      <span v-if="!data.length">{{ typeof empty === 'string' ? empty : empty.title }}</span>
      <div v-for="row in data" :key="row.id" data-testid="table-row">
        {{ row.itemName || row.category }}
      </div>
    </div>
  `,
  })

  describe('target cost detail presentation', () => {
    it('keeps item table in its own reusable table surface', () => {
      const item = {
        id: 'item-1',
        category: '材料' as const,
        itemName: 'BV 电线',
        unit: 'm',
        qty: 100,
        unitPrice: 2.5,
        amount: 250,
        note: '',
        sortOrder: 10,
      }
      const itemTable = mount(TargetCostItemTable, {
        props: { items: [item] },
        global: { components: { KitTable } },
      })
      expect(itemTable.get('[data-testid="kit-table"]').text()).toContain('BV 电线')
      expect(itemTable.text()).toContain('当前版本共 1 行')
    })
  })
})

describe('目标成本附件', () => {
  afterEach(() => vi.restoreAllMocks())
  it('下载具有真实原件且旧大小未知的附件，并继续校验原始字节摘要', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70])
    const digest = Buffer.from(await webcrypto.subtle.digest('SHA-256', bytes)).toString('hex')
    const context = { workspaceId: 'w', actorId: 'a', origin: 'real' as const, capabilities: ['target-cost:read'], sourceVersion: 'v' }
    const current = { context, targetCostId: 'budget' }
    const readFile = vi.fn().mockResolvedValue({ context, content: { fileId: 'file', targetCostId: 'budget', state: 'available', fileName: '原件.pdf', fileSize: null, mimeType: 'application/pdf', payloadBase64: Buffer.from(bytes).toString('base64'), sha256: digest } })
    vi.stubGlobal('crypto', webcrypto)
    vi.stubGlobal('useNuxtApp', () => ({ $repositories: { targetCosts: { file: readFile } } }))
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:budget')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const error = vi.fn()
    let ui!: ReturnType<typeof useTargetCostFiles>
    const wrapper = mount(defineComponent({ setup() {
      ui = useTargetCostFiles({ current: () => current, active: () => true, error })
      return () => h('div')
    } }))
    await ui.download('file')
    expect(error).not.toHaveBeenCalled()
    expect(click).toHaveBeenCalledOnce()
    expect(new Uint8Array(await create.mock.calls[0]![0].arrayBuffer())).toEqual(bytes)
    readFile.mockResolvedValue({ context, content: { fileId: 'file', targetCostId: 'budget', state: 'available', fileName: '原件.pdf', fileSize: null, payloadBase64: 'AA==', sha256: digest } })
    await ui.download('file')
    expect(error).toHaveBeenCalledWith('附件原件校验未通过，请重新读取')
    expect(click).toHaveBeenCalledOnce()
    wrapper.unmount()
    expect(revoke).toHaveBeenCalledWith('blob:budget')
  })
})
