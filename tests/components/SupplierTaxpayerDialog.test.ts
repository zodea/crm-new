import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import SupplierTaxpayerDialog from '~/components/supplier/SupplierTaxpayerDialog.vue'
import { credentialProblem } from '~/lib/supplier/credential-contract'
import { createTaxpayerEditorState } from '~/lib/supplier/taxpayer-editor-state'

describe('人工税务核验对话框', () => {
  it('失败后保留实际输入，冲突明确重读，恢复正常后才关闭', async () => {
    const execute = vi.fn().mockRejectedValueOnce(credentialProblem('conflict', '主档已有更新')).mockResolvedValue({ verification: {} })
    const state = createTaxpayerEditorState({
      target: () => ({ supplierId: 'supplier', origin: 'real', version: '1', enabled: true, draft: { taxNo: 'TAX-A' }, saved: { taxNo: 'TAX-A' } }),
      pending: () => null,
      execute,
      read: async () => ({ draft: { id: 'supplier', name: '合成分供方', taxNo: 'TAX-A' }, version: '2', attachments: [], updatedAt: '2026-09-12T00:00:00.000Z' }),
      apply: vi.fn(),
    })
    state.begin()
    render(defineComponent({ components: { SupplierTaxpayerDialog }, setup: () => ({ state }), template: `<SupplierTaxpayerDialog v-if="state.open.value" :value="state.form" :tax-no="state.taxNo.value" :busy="state.busy.value" :locked="state.locked.value" :conflict="state.conflict.value" :error="state.error.value" :summary="state.summary.value" @patch="value => Object.assign(state.form, value)" @submit="state.save" @recheck="state.recheck" @cancel="state.close" />` }))
    await fireEvent.update(await screen.findByLabelText('核验结果'), 'not_found')
    await fireEvent.update(screen.getByLabelText('核验备注'), '官网查询没有匹配，等待补充材料')
    await fireEvent.click(screen.getByRole('button', { name: '保存核验记录' }))
    expect((await screen.findByRole('alert')).textContent).toContain('主档已有更新')
    expect((screen.getByLabelText('核验备注') as HTMLTextAreaElement).value).toBe('官网查询没有匹配，等待补充材料')
    await fireEvent.click(screen.getByRole('button', { name: '重新核对当前主档' }))
    await waitFor(() => expect((screen.getByRole('button', { name: '保存核验记录' }) as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: '保存核验记录' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(execute.mock.calls[1]![0]).toMatchObject({ baseSupplierVersion: '2', draft: { status: 'not_found', note: '官网查询没有匹配，等待补充材料' } })
  })
  it('未确认响应时输入锁定，保留原始内容和恢复提交入口', async () => {
    render(SupplierTaxpayerDialog, { props: { value: { status: 'not_found', taxpayerType: '小规模纳税人', note: '原始核验输入' }, taxNo: 'TAX-A', busy: false, locked: true, conflict: false, error: '响应丢失', summary: '' } })
    expect((await screen.findByLabelText('核验备注') as HTMLTextAreaElement).value).toBe('原始核验输入')
    expect(screen.getByLabelText('核验备注').closest('fieldset')?.disabled).toBe(true)
    expect((screen.getByRole('button', { name: '恢复原提交' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
