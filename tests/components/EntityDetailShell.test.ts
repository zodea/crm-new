import { fireEvent, render, screen } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import EntityDetailShell from '~/components/ui/EntityDetailShell.vue'

const NuxtLinkStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      required: true,
    },
  },
  setup(props, { slots }) {
    return () => h('a', {
      href: typeof props.to === 'string' ? props.to : '#',
    }, slots.default?.())
  },
})

const global = {
  components: {
    NuxtLink: NuxtLinkStub,
  },
}

describe('entityDetailShell', () => {
  it('organizes header, caller-ordered modules and an optional aside without absorbing domain content', () => {
    render(EntityDetailShell, {
      props: {
        title: '超长分供方名称用于验证详情标题自然换行而不是截断',
        subtitle: 'SUP-2026-0001 · 专业分包',
        backTo: '/base/supplier',
        backLabel: '返回分供方列表',
        asideLabel: '分供方文件与动态',
      },
      slots: {
        mark: '<span>供</span>',
        status: '<span>资料合格</span>',
        actions: '<button type="button">编辑</button>',
        summary: '<section data-module="summary">经营指标</section>',
        default: `
          <section data-module="process">流程事实</section>
          <nav data-module="tabs">业务页签</nav>
          <section data-module="content">密集子表</section>
        `,
        aside: '<section>文件管理</section>',
      },
      global,
    })

    expect(screen.getByRole('heading', {
      name: '超长分供方名称用于验证详情标题自然换行而不是截断',
    })).not.toBeNull()
    expect(screen.getByRole('link', { name: '返回分供方列表' }).getAttribute('href'))
      .toBe('/base/supplier')
    expect(screen.getByRole('button', { name: '编辑' })).not.toBeNull()
    expect(screen.getByRole('complementary', { name: '分供方文件与动态' })).not.toBeNull()

    const modules = [...document.querySelectorAll('[data-module]')]
      .map(element => element.getAttribute('data-module'))
    expect(modules).toEqual(['summary', 'process', 'tabs', 'content'])
  })

  it.each([
    { state: 'loading', role: 'status', title: '正在加载分供方详情' },
    { state: 'empty', role: 'status', title: '该分供方还没有业务数据' },
    { state: 'forbidden', role: 'status', title: '无权查看该分供方' },
    { state: 'not-found', role: 'status', title: '分供方不存在或已删除' },
  ] as const)('uses the shared state surface for $state', ({ state, role, title }) => {
    render(EntityDetailShell, {
      props: { title: '分供方详情', state, stateTitle: title },
      global,
    })
    expect(screen.getByRole(role, { name: title })).not.toBeNull()
  })

  it('keeps the return route available when the entity does not exist', () => {
    render(EntityDetailShell, {
      props: {
        title: '分供方详情',
        state: 'not-found',
        stateTitle: '分供方不存在或已删除',
        backTo: '/base/supplier',
        backLabel: '返回分供方列表',
      },
      global,
    })

    expect(screen.getByRole('link', { name: '返回分供方列表' }).getAttribute('href'))
      .toBe('/base/supplier')
  })

  it('announces an error and emits the retry action', async () => {
    const view = render(EntityDetailShell, {
      props: {
        title: '分供方详情',
        state: 'error',
        stateTitle: '分供方详情加载失败',
        stateDescription: '数据库暂时不可用。',
        stateActionLabel: '重新加载',
      },
      global,
    })

    expect(screen.getByRole('alert', { name: '分供方详情加载失败' })).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    expect(view.emitted().stateAction).toHaveLength(1)
  })
})
