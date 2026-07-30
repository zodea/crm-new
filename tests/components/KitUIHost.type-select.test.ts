import { fireEvent, screen } from '@testing-library/vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ConfirmDialog from '~/components/shared/ConfirmDialog.vue'
import KitFormModal from '~/components/shared/KitFormModal.vue'
import KitTypeSelectDialog from '~/components/shared/KitTypeSelectDialog.vue'
import KitUIHost from '~/components/shared/KitUIHost.vue'
import Button from '~/components/ui/button/Button.vue'
import Dialog from '~/components/ui/dialog/Dialog.vue'
import DialogContent from '~/components/ui/dialog/DialogContent.vue'
import DialogDescription from '~/components/ui/dialog/DialogDescription.vue'
import DialogTitle from '~/components/ui/dialog/DialogTitle.vue'
import {
  confirm,
  formModal,
  typeSelect,
  useKitUIHostState,
} from '~/composables/useKitUI'

const hostState = useKitUIHostState()
const mountedHosts: Array<ReturnType<typeof mount>> = []

beforeAll(() => {
  vi.stubGlobal('useKitUIHostState', useKitUIHostState)
})

afterEach(async () => {
  for (const wrapper of mountedHosts.splice(0))
    wrapper.unmount()
  hostState.resolveConfirm(false)
  hostState.resolveFormModal(null)
  hostState.resolveTypeSelect(null)
  await nextTick()
})

function mountHost() {
  const wrapper = mount(KitUIHost, {
    attachTo: document.body,
    global: {
      components: {
        Button,
        ConfirmDialog,
        Dialog,
        DialogContent,
        DialogDescription,
        DialogTitle,
        KitFormModal,
        KitTypeSelectDialog,
        ToastHost: { template: '<div data-testid="toast-host" />' },
      },
    },
  })
  mountedHosts.push(wrapper)
  return wrapper
}

function surfaceFor(title: string) {
  return [...document.querySelectorAll<HTMLElement>('[data-overlay-surface]')]
    .find(surface => surface.textContent?.includes(title))
}

function backdropAt(offset: string) {
  return [...document.querySelectorAll<HTMLElement>('[data-overlay-backdrop]')]
    .find(backdrop => backdrop.style.getPropertyValue('--overlay-layer-offset') === offset)
}

describe('kitUIHost typeSelect integration', () => {
  it('同类抢占在 Dialog 保持打开时重置选项并聚焦新的默认 radio', async () => {
    const wrapper = mountHost()
    const first = typeSelect({
      title: '第一次选择',
      options: [
        { value: 'a', label: '类型 A' },
        { value: 'b', label: '类型 B' },
      ],
      defaultValue: 'a',
    })

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: '类型 A' }))
    })

    const second = typeSelect({
      title: '第二次选择',
      options: [
        { value: 'c', label: '类型 C' },
        { value: 'd', label: '类型 D' },
      ],
      defaultValue: 'd',
    })

    await expect(first).resolves.toBeNull()
    await vi.waitFor(() => {
      const selected = screen.getByRole('radio', { name: '类型 D' }) as HTMLInputElement
      expect(selected.checked).toBe(true)
      expect(document.activeElement).toBe(selected)
    })

    await fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    await expect(second).resolves.toBe('d')
    wrapper.unmount()
  })

  it('同类抢占复用同一 options 对象时仍恢复默认值与焦点', async () => {
    const wrapper = mountHost()
    const sharedOptions = {
      title: '选择固定业务类型',
      options: [
        { value: 'a', label: '类型 A' },
        { value: 'b', label: '类型 B' },
      ],
      defaultValue: 'a',
    } as const
    const first = typeSelect(sharedOptions)
    const firstRadio = await screen.findByRole('radio', { name: '类型 A' })
    await fireEvent.keyDown(firstRadio, { key: 'ArrowDown' })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: '类型 B' }))
    })

    const second = typeSelect(sharedOptions)
    await expect(first).resolves.toBeNull()
    await vi.waitFor(() => {
      const selected = screen.getByRole('radio', { name: '类型 A' }) as HTMLInputElement
      expect(selected.checked).toBe(true)
      expect(document.activeElement).toBe(selected)
    })

    hostState.resolveTypeSelect('a')
    await expect(second).resolves.toBe('a')
    wrapper.unmount()
  })

  it('与 formModal/confirm 使用真实模态栈，遮罩和 Esc 只关闭顶层并恢复焦点', async () => {
    const origin = document.createElement('button')
    origin.textContent = '打开类型选择'
    document.body.append(origin)
    origin.focus()
    const wrapper = mountHost()

    const typePromise = typeSelect({
      title: '选择付款类型',
      options: [
        { value: 'contract', label: '有合同付款' },
        { value: 'company', label: '公司付款' },
      ],
    })
    const typeRadio = await screen.findByRole('radio', { name: '有合同付款' })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(typeRadio)
      expect(surfaceFor('选择付款类型')?.style.getPropertyValue('--overlay-layer-offset')).toBe('0')
    })

    const formPromise = formModal({
      title: '补充付款信息',
      fields: [{ key: 'remark', label: '说明' }],
    })
    await screen.findByRole('heading', { name: '补充付款信息' })
    await vi.waitFor(() => {
      expect(surfaceFor('补充付款信息')?.style.getPropertyValue('--overlay-layer-offset')).toBe('10')
      expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '说明' }))
    })

    // DialogContent 对开窗双击有 300ms 遮罩宽限；超过宽限后真实点击顶层遮罩。
    await new Promise(resolve => setTimeout(resolve, 320))
    const formBackdrop = backdropAt('10')
    expect(formBackdrop).toBeDefined()
    await fireEvent.pointerDown(formBackdrop!, { button: 0, pointerType: 'mouse' })

    await vi.waitFor(() => {
      expect(hostState.formModalState.value).toBeNull()
      expect(hostState.typeSelectState.value).not.toBeNull()
      expect(document.activeElement).toBe(typeRadio)
    })
    await expect(formPromise).resolves.toBeNull()

    const confirmPromise = confirm({
      title: '确认继续',
      message: '仅关闭当前确认弹窗。',
    })
    await screen.findByRole('heading', { name: '确认继续' })
    await vi.waitFor(() => {
      expect(surfaceFor('确认继续')?.style.getPropertyValue('--overlay-layer-offset')).toBe('10')
      expect(document.activeElement).toBe(screen.getAllByRole('button', { name: '取消' }).at(-1))
    })

    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await expect(confirmPromise).resolves.toBe(false)
    await vi.waitFor(() => {
      expect(hostState.typeSelectState.value).not.toBeNull()
      expect(document.activeElement).toBe(typeRadio)
    })

    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await expect(typePromise).resolves.toBeNull()
    await vi.waitFor(() => {
      expect(document.querySelectorAll('[data-overlay-surface]')).toHaveLength(0)
      expect(document.activeElement).toBe(origin)
    })
    wrapper.unmount()
  })
})
