import { mount } from '@vue/test-utils'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import ContractDetailDocuments from '~/components/contract/ContractDetailDocuments.vue'
import ContractDetailFiles from '~/components/contract/ContractDetailFiles.vue'
import ContractLifecycle from '~/components/contract/ContractLifecycle.vue'
import { contractStages } from '~/lib/contract/detail'

const preview = vi.fn()
const download = vi.fn()

const SectionHeader = defineComponent({
  props: ['title', 'subtitle'],
  template: '<header><h2>{{ title }}</h2><p>{{ subtitle }}</p></header>',
})

const StatePanel = defineComponent({
  props: ['title', 'description'],
  template: '<div role="status" :aria-label="title">{{ title }} {{ description }}</div>',
})

const KitTable = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    return () => h('div', { 'data-testid': 'table-stub' }, (props.data ?? []).map((row: unknown) =>
      h('div', [
        slots.no?.({ row }),
        slots.name?.({ row }),
        slots.amount?.({ row }),
        slots.status?.({ row }),
      ]),
    ))
  },
})

const global = {
  components: {
    KitTable,
    SectionHeader,
    StatePanel,
  },
  stubs: {
    NuxtLink: {
      props: ['to'],
      template: '<a :href="to"><slot /></a>',
    },
  },
}

describe('contract detail sections', () => {
  beforeAll(() => {
    vi.stubGlobal('useFileRefAccess', () => ({ preview, download }))
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('合同阶段为当前节点设置 aria-current', () => {
    const wrapper = mount(ContractLifecycle, {
      props: { stages: contractStages('履约中') },
      global,
    })

    expect(wrapper.get('[aria-current="step"]').text()).toContain('履约')
    expect(wrapper.findAll('li')).toHaveLength(5)
  })

  it('关联单据展示真实下钻；无数据时展示明确空态', () => {
    const wrapper = mount(ContractDetailDocuments, {
      props: {
        rows: [{
          id: 'change-a',
          group: '甲方变洽签',
          no: 'BG-001',
          name: '现场签证',
          amount: 120,
          date: '2026-06-01',
          status: 'approved',
          to: '/owner/change/change-a',
        }],
      },
      global,
    })
    expect(wrapper.get('a').attributes('href')).toBe('/owner/change/change-a')
    expect(wrapper.text()).toContain('BG-001')
    expect(wrapper.text()).toContain('现场签证')

    const empty = mount(ContractDetailDocuments, {
      props: { rows: [] },
      global,
    })
    expect(empty.get('[role="status"]').attributes('aria-label')).toBe('暂无关联单据')
  })

  it('合同文件只对真实文件引用提供预览和下载动作', async () => {
    const file = {
      id: 'file-a',
      ownerType: 'contract',
      ownerId: 'contract-a',
      fileName: '正式合同.pdf',
      filePath: '',
      fileSize: 2048,
      mimeType: 'application/pdf',
      category: '正式合同',
      uploader: '经办人',
      uploadedAt: '2026-07-30',
      deletedAt: null,
    }
    const wrapper = mount(ContractDetailFiles, {
      props: { files: [file] },
      global,
    })

    await wrapper.get('button:nth-of-type(1)').trigger('click')
    await wrapper.get('button:nth-of-type(2)').trigger('click')
    expect(preview).toHaveBeenCalledWith(file)
    expect(download).toHaveBeenCalledWith(file)
    expect(wrapper.text()).toContain('2.0 KB')
  })
})
