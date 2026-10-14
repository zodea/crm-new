import type { Component } from 'vue'
import type { ExpenseClearanceSourceDTO } from '~/lib/finance/clearance-verification'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import ContractAttachmentSection from '~/components/contract/ContractAttachmentSection.vue'
import QuotationFormPage from '~/components/material/quotation/QuotationFormPage.vue'
import OtherSettlementFormFields from '~/components/other-settlement/OtherSettlementFormFields.vue'
import OtherSettlementFormPage from '~/components/other-settlement/OtherSettlementFormPage.vue'
import CommandRecoveryPanel from '~/components/shared/CommandRecoveryPanel.vue'
import FileRefAttachmentSection from '~/components/shared/FileRefAttachmentSection.vue'
import EntityFormShell from '~/components/ui/EntityFormShell.vue'
import FormFooter from '~/components/ui/FormFooter.vue'
import KitButton from '~/components/ui/KitButton.vue'
import StatePanel from '~/components/ui/StatePanel.vue'
import { useContractFormAttachments } from '~/composables/useContractFormAttachments'
import { useOtherSettlementForm } from '~/composables/useOtherSettlementForm'
import { auxiliaryProblem } from '~/lib/auxiliary-contract/contract'
import { newQuotationDraft } from '~/lib/material-quotation/contract'
import { wrapTabRouteComponents } from '~/lib/tabs/page-cache'
import { useProductionAccessStore } from '~/stores/production-access'
import { useTabsStore } from '~/stores/tabs'

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('~/composables/useTabCloseGuard', () => ({ useTabCloseGuard: vi.fn() }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  setActivePinia(createPinia())
  sessionStorage.clear()
  for (const name of ['computed', 'ref', 'shallowRef', 'watch', 'nextTick', 'onMounted', 'onActivated', 'onDeactivated', 'onBeforeUnmount'] as const)
    vi.stubGlobal(name, Vue[name])
  vi.stubGlobal('useTabTitle', vi.fn())
  vi.stubGlobal('useTabCloseGuard', vi.fn())
  vi.stubGlobal('useContractFormAttachments', useContractFormAttachments)
  vi.stubGlobal('useOtherSettlementForm', useOtherSettlementForm)
})
afterEach(() => {
  sessionStorage.clear()
  vi.unstubAllGlobals()
})

async function fixture(kind: 'quotation' | 'other', unknown: boolean, clearance?: ExpenseClearanceSourceDTO) {
  const prefix = kind === 'quotation' ? '/material/quotations' : '/contract/other-settlement'
  const actor = { workspaceId: 'actual-workspace', actorId: 'actual-owner', capabilities: ['material-quotation:write', 'other-settlement:write'] }
  const confirmed = vi.fn(async () => false)
  const success = vi.fn()
  vi.stubGlobal('useKitUI', () => ({ confirm: confirmed, success, error: vi.fn() }))
  const initialDraft = kind === 'quotation'
    ? { ...newQuotationDraft(), partyName: '已提交原报价方' }
    : { name: '已提交原结算', projectId: null, contractId: null, supplierId: null, totalAmount: clearance ? 30 : 0, taxRate: null, status: clearance ? 'confirmed' : 'draft', ...(clearance ? { originalExpenses: [{ originalExpenseLineId: clearance.id, sourceVersion: clearance.version, sourceRevision: clearance.sourceRevision, amount: 30 }] } : {}) }
  const originalFile = { id: 'saved-original-file', fileName: '原件A.txt', fileSize: 1, mimeType: 'text/plain', category: '合同附件', uploader: actor.actorId, uploadedAt: '2026-10-05T00:00:00.000Z', deletedAt: null }
  let savedDraft: object = initialDraft
  let savedVersion = clearance ? '0' : '1'
  let savedFiles = [originalFile]
  let release!: () => void
  const held = new Promise<void>(resolve => release = resolve)
  const commands: Array<{ id?: string, baseVersion: string | null, commandId: string, draft: Record<string, unknown>, attachments: { add: Array<{ fileName: string, payloadBase64: string }> } }> = []
  let omitLinks = true
  const actualLink = { id: 'saved-clearance-link', expenseAllocationId: 'actual-adoption-line', settlementId: 'saved-record-one', originalExpenseLineId: clearance?.id ?? '', verificationId: clearance?.qualification.verificationId ?? '', itemId: 'recognized-old-item', amount: 30, createdAt: '2026-10-05T00:00:00.000Z', actorId: actor.actorId }
  const result = (commandId: string) => ({ commandId, id: 'saved-record-one', version: savedVersion, updatedAt: '2026-10-05T00:00:00.000Z', attachmentIds: savedFiles.map(file => file.id), ...(clearance ? { clearanceLinkIds: [actualLink.id] } : {}) })
  const repository = {
    context: vi.fn(async () => ({ ...actor, projects: [], suppliers: [], workers: [], contracts: [] })),
    expenses: vi.fn(async () => ({ ...actor, items: clearance ? [clearance] : [] })),
    loadForm: vi.fn(async () => ({ draft: { ...savedDraft, id: 'saved-record-one' }, version: savedVersion, updatedAt: '2026-10-05T00:00:00.000Z', attachments: savedFiles, history: [], expenseAllocations: clearance ? [{ id: 'actual-adoption-line', originalExpenseLineId: clearance.id, amount: 30, sourceVersion: clearance.version, sourceRevision: clearance.sourceRevision }] : [], clearanceLinks: clearance && !omitLinks ? [actualLink] : [] })),
    execute: vi.fn(async (request: typeof commands[number]) => {
      commands.push(structuredClone(request))
      if (!clearance)
        savedDraft = structuredClone(request.draft)
      if (commands.length === 1) {
        await held
        if (unknown)
          throw auxiliaryProblem('unavailable', '提交结果未知，原编号保留')
      }
      else {
        savedVersion = '2'
        savedFiles = [...savedFiles, { ...originalFile, id: 'saved-later-file', fileName: '后来B.txt' }]
      }
      return result(request.commandId)
    }),
    resolve: vi.fn(async (commandId: string) => ({ outcome: 'applied', result: result(commandId) })),
  }
  vi.stubGlobal('useMaterialQuotationRepository', () => repository)
  vi.stubGlobal('useNuxtApp', () => ({ $repositories: { otherSettlements: repository, productionAccess: { status: async () => ({ mode: 'production', authenticated: true, ownerId: actor.actorId, purpose: 'component-recovery' }), logout: async () => undefined } } }))
  await useProductionAccessStore().check()
  const base: Component = kind === 'quotation' ? QuotationFormPage : OtherSettlementFormPage
  const createPage = Vue.defineComponent({ setup: () => () => Vue.h(base) })
  const editPage = kind === 'quotation' ? createPage : Vue.defineComponent({ setup: () => () => Vue.h(base) })
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: `${prefix}/form`, component: createPage },
    { path: `${prefix}/form/:id`, component: editPage },
    { path: '/actual-other-page', component: Vue.defineComponent({ setup: () => () => Vue.h('p', '其他页面') }) },
  ] })
  router.beforeResolve(wrapTabRouteComponents)
  await router.push(`${prefix}/form${clearance ? '/saved-record-one?origin=real' : ''}`)
  await router.isReady()
  vi.stubGlobal('useRoute', () => router.currentRoute.value)
  vi.stubGlobal('useRouter', () => router)
  vi.stubGlobal('navigateTo', (target: string) => router.push(target))
  const tabs = useTabsStore()
  const host = Vue.defineComponent({ setup: () => () => Vue.h(RouterView, {}, { default: ({ Component, route }: { Component: Component, route: { fullPath: string } }) => Component ? Vue.h(Component, { key: tabs.pageCacheKey(route.fullPath) }) : null }) })
  const wrapper = mount(host, { global: { plugins: [router], components: { EntityFormShell, FormFooter, KitButton, StatePanel, OtherSettlementFormFields, ContractAttachmentSection, FileRefAttachmentSection, CommandRecoveryPanel }, stubs: { LookupSelect: true, SectionHeader: true, NuxtLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } } })
  await flushPromises()
  return { prefix, commands, repository, confirmed, success, release, wrapper, page: () => wrapper.getComponent(base), router, allowLinks: () => {
    omitLinks = false
  } }
}

function linkSource(): ExpenseClearanceSourceDTO {
  return { id: 'original-expense-line', headerId: 'original-expense-head', projectId: null, amount: 100, version: '2', sourceRevision: 'finance-10', clearedAmount: 30, expenseItem: '真实原费', serviceSupplierId: 'actual-service', serviceSupplierNameSnapshot: '原服务方', applicantWorkerId: null, applicantSupplierId: 'actual-payee', applicantNameSnapshot: '实际垫付人', clearances: [], clearanceSourceHash: 'a'.repeat(64), clearanceLinks: [], clearanceItemAvailability: [{ verificationId: 'actual-verification', itemId: 'recognized-old-item', amountRemaining: 30 }], clearanceProofs: [{ schemaVersion: 'expense-clearance-verification-v1', id: 'actual-verification', originalExpenseLineId: 'original-expense-line', headerId: 'original-expense-head', expenseVersion: '2', sourceHash: 'a'.repeat(64), workspaceId: 'actual-workspace', actorId: 'actual-owner', verifiedAt: '2026-10-05T00:00:00.000Z', commandId: 'source-verification-command', basis: '已核旧30尚待实付', items: [{ id: 'recognized-old-item', sourceClearanceLineId: 'old-clearance-line', amount: 30, matchBasis: '真实旧30份额', missingOriginalDocument: true }], originals: [{ id: 'real-proof-file', ownerType: 'expense_reimbursement', ownerId: 'original-expense-head', fileName: '原账签收.bin', fileSize: 4, sha256: 'b'.repeat(64) }], sourceSnapshot: {} }], qualification: { state: 'verified', message: '旧30需明确绑定本头真实采用行', verificationId: 'actual-verification', recordedHandledAmount: 30, verifiedHandledAmount: 30, confirmedOtherAdoptedAmount: 30, verifiedOverlapAmount: 0, newAdoptableAmount: 40, legacyObligationAmount: 30, legacyPaidAmount: null, legacyUnpaidAmount: null } }
}

it('other表单中重新核对费用及采用公司归属只改变读面和当前输入，不触发原业务提交', async () => {
  const f = await fixture('other', false)
  const form = f.page()
  const fields = form.getComponent(OtherSettlementFormFields)
  await form.findAll('label').find(label => label.text().trim() === '结算名称 *')!.get('input').setValue('仍未提交的实际结算')
  fields.vm.$emit('patch', { projectId: 'actual-project' })
  await flushPromises()
  const initialReads = f.repository.expenses.mock.calls.length
  const reload = form.findAll('button').find(button => button.text() === '重新核对原费用来源')!
  expect(reload.attributes('type')).toBe('button')
  reload.element.click()
  await flushPromises()
  expect(f.repository.expenses).toHaveBeenCalledTimes(initialReads + 1)
  expect(f.repository.execute).not.toHaveBeenCalled()
  expect(fields.props('draft')).toMatchObject({ name: '仍未提交的实际结算', projectId: 'actual-project' })
  const companyScope = form.findAll('button').find(button => button.text() === '采用公司归属')!
  expect(companyScope.attributes('type')).toBe('button')
  companyScope.element.click()
  await flushPromises()
  expect(fields.props('draft')).toMatchObject({ name: '仍未提交的实际结算', projectId: null })
  expect(f.repository.execute).not.toHaveBeenCalled()
  expect(f.commands).toEqual([])
})

it.each([false, true])('confirmed追加关联未知=%s保原head0/正文，receiptlink缺读先保原key，再只GET恢复不重发', async (unknown) => {
  const f = await fixture('other', unknown, linkSource())
  const form = f.page()
  await form.get('select[aria-label="选择已核旧份额来源"]').setValue('actual-verification')
  await form.findAll('button').find(button => button.text() === '新增明确关联')!.trigger('click')
  await form.get('select[aria-label="第 1 项实际采用行"]').setValue('actual-adoption-line')
  await form.get('select[aria-label="第 1 项已核旧份额"]').setValue('recognized-old-item')
  await form.get('input[aria-label="第 1 项明确重叠金额"]').setValue('30')
  await form.findAll('button').find(button => button.text() === '保存旧份额关联')!.trigger('click')
  await flushPromises()
  expect(f.commands).toHaveLength(1)
  expect(f.commands[0]).toMatchObject({ id: 'saved-record-one', baseVersion: '0', action: 'save', draft: { id: 'saved-record-one', clearanceLinkEdit: { verificationId: 'actual-verification', bindings: [{ expenseAllocationId: 'actual-adoption-line', itemId: 'recognized-old-item', amount: 30 }] } }, attachments: {} })
  expect(Object.keys(f.commands[0]!.draft)).toEqual(['id', 'clearanceLinkEdit'])
  f.release()
  await flushPromises()
  const recover = form.findAll('button').find(button => button.text() === '核对原提交')!
  expect(recover.attributes('type')).toBe('button')
  recover.element.click()
  await flushPromises()
  expect(form.text()).toContain('已保存待刷新，只重试读取')
  expect(f.repository.resolve).toHaveBeenCalledTimes(unknown ? 1 : 0)
  expect(f.commands).toHaveLength(1)
  expect(f.page().getComponent(OtherSettlementFormFields).props('draft')).toMatchObject({ name: '已提交原结算', totalAmount: 30, status: 'confirmed' })
  f.allowLinks()
  await form.findAll('button').find(button => button.text() === '核对原提交')!.trigger('click')
  await flushPromises()
  expect(f.repository.resolve).toHaveBeenCalledTimes(unknown ? 1 : 0)
  expect(f.commands).toHaveLength(1)
  expect(form.findAll('button').some(button => button.text() === '核对原提交')).toBe(false)
  expect(f.router.currentRoute.value.fullPath).toBe('/contract/other-settlement/form/saved-record-one?origin=real')
  expect(f.confirmed).not.toHaveBeenCalled()
})

it.each(['authority', 'unmount'] as const)('原恢复等待canonical路由时%s不清新权限错误或发布迟到成功', async (change) => {
  const f = await fixture('other', true)
  const form = f.page()
  const name = form.findAll('label').find(label => label.text().trim() === '结算名称 *')!.get('input')
  await name.setValue('已提交原结算')
  await form.getComponent(FormFooter).findAll('button').find(button => button.text() === '保存')!.trigger('click')
  await flushPromises()
  f.release()
  await flushPromises()
  let releaseNavigation!: () => void
  let startedNavigation!: () => void
  const held = new Promise<void>(resolve => releaseNavigation = resolve)
  const started = new Promise<void>(resolve => startedNavigation = resolve)
  f.router.beforeEach(async (to) => {
    if (to.fullPath === '/contract/other-settlement/form/saved-record-one?origin=real') {
      startedNavigation()
      await held
      return false
    }
  })
  await form.findAll('button').find(button => button.text() === '核对原提交')!.trigger('click')
  await started
  if (change === 'authority')
    await useProductionAccessStore().logout()
  else f.wrapper.unmount()
  releaseNavigation()
  await flushPromises()
  expect(f.success).not.toHaveBeenCalled()
  expect(f.commands).toHaveLength(1)
  expect(f.repository.resolve).toHaveBeenCalledTimes(1)
  if (change === 'authority')
    expect(f.wrapper.find('[role="alert"][aria-label="登录已失效，请重新登录后读取。"]').exists()).toBe(true)
})

it.each([true, false])('other首次保存未知=%s后晚字段及原件保原实例；下一保存仍同ID/版本且真正离页确认', async (unknown) => {
  const f = await fixture('other', unknown)
  const form = f.page()
  const instance = form.vm.$.uid
  await form.getComponent(FormFooter).get('input[type="checkbox"]').setValue(false)
  const name = form.findAll('label').find(label => label.text().trim() === '结算名称 *')!.get('input')
  await name.setValue('已提交原结算')
  form.getComponent(ContractAttachmentSection).vm.$emit('files', [new File(['A'], '原件A.txt', { type: 'text/plain' })])
  await flushPromises()
  await form.getComponent(FormFooter).findAll('button').find(button => button.text() === '保存')!.trigger('click')
  await flushPromises()
  expect(f.commands).toHaveLength(1)
  await name.setValue('后来尚未提交的结算')
  form.getComponent(ContractAttachmentSection).vm.$emit('files', [new File(['B'], '后来B.txt', { type: 'text/plain' })])
  await flushPromises()
  f.release()
  await flushPromises()
  if (unknown) {
    await form.findAll('button').find(button => button.text() === '核对原提交')!.trigger('click')
    await flushPromises()
  }
  expect(f.confirmed).not.toHaveBeenCalled()
  expect(f.router.currentRoute.value.fullPath).toBe('/contract/other-settlement/form')
  expect(f.page().vm.$.uid).toBe(instance)
  expect(name.element.value).toBe('后来尚未提交的结算')
  expect(form.getComponent(ContractAttachmentSection).props('pendingAttachments')).toMatchObject([{ fileName: '后来B.txt', payloadBase64: 'Qg==' }])
  expect(f.repository.resolve).toHaveBeenCalledTimes(unknown ? 1 : 0)
  expect(form.getComponent(EntityFormShell).props('title')).toBe('编辑 · 其他支出结算')
  await f.router.push('/actual-other-page')
  await flushPromises()
  expect(f.confirmed).toHaveBeenCalledTimes(1)
  expect(f.router.currentRoute.value.fullPath).toBe('/contract/other-settlement/form')
  await form.getComponent(FormFooter).findAll('button').find(button => button.text() === '保存')!.trigger('click')
  await flushPromises()
  expect(f.commands[1]).toMatchObject({ id: 'saved-record-one', baseVersion: '1', draft: { name: '后来尚未提交的结算' }, attachments: { add: [{ fileName: '后来B.txt', payloadBase64: 'Qg==' }] } })
  expect(f.commands).toHaveLength(2)
  expect(f.commands[0]).toMatchObject({ baseVersion: null, attachments: { add: [{ fileName: '原件A.txt', payloadBase64: 'QQ==' }] } })
  expect(f.commands[1]!.commandId).not.toBe(f.commands[0]!.commandId)
  expect(f.router.currentRoute.value.fullPath).toBe('/contract/other-settlement/form/saved-record-one?origin=real')
  expect(f.repository.loadForm).toHaveBeenLastCalledWith('saved-record-one')
  expect(f.page().getComponent(OtherSettlementFormFields).props('draft')).toMatchObject({ id: 'saved-record-one', name: '后来尚未提交的结算' })
  expect(f.confirmed).toHaveBeenCalledTimes(1)
})

it.each([true, false])('quote首次保存未知=%s后晚字段与提交前已开始读取的后来原件保原实例；下一保存同ID递增版本', async (unknown) => {
  const f = await fixture('quotation', unknown)
  const form = f.page()
  const instance = form.vm.$.uid
  await form.getComponent(FormFooter).get('input[type="checkbox"]').setValue(false)
  const party = form.get('[data-testid="quotation-party"]')
  await party.setValue('已提交原报价方')
  form.getComponent(FileRefAttachmentSection).vm.$emit('files', [new File(['A'], '原件A.txt', { type: 'text/plain' })])
  await flushPromises()
  let releaseFile!: (buffer: ArrayBuffer) => void
  const laterFile = new File(['B'], '后来B.txt', { type: 'text/plain' })
  vi.spyOn(laterFile, 'arrayBuffer').mockImplementation(() => new Promise<ArrayBuffer>(resolve => releaseFile = resolve))
  form.getComponent(FileRefAttachmentSection).vm.$emit('files', [laterFile])
  await flushPromises()
  await form.getComponent(FormFooter).findAll('button').find(button => button.text() === '保存')!.trigger('click')
  await flushPromises()
  expect(f.commands).toHaveLength(1)
  await party.setValue('后来尚未提交的报价方')
  releaseFile(new Uint8Array([66]).buffer)
  await flushPromises()
  f.release()
  await flushPromises()
  if (unknown) {
    await form.getComponent(CommandRecoveryPanel).findAll('button').find(button => button.text() === '核对原提交')!.trigger('click')
    await flushPromises()
  }
  expect(f.router.currentRoute.value.fullPath).toBe('/material/quotations/form')
  expect(f.page().vm.$.uid).toBe(instance)
  expect(party.element.value).toBe('后来尚未提交的报价方')
  expect(form.getComponent(FileRefAttachmentSection).props('pendingAttachments')).toMatchObject([{ fileName: '后来B.txt', payloadBase64: 'Qg==' }])
  expect(f.repository.resolve).toHaveBeenCalledTimes(unknown ? 1 : 0)
  expect(f.confirmed).not.toHaveBeenCalled()
  expect(form.getComponent(EntityFormShell).props('title')).toBe('编辑 · 材料报价')
  await form.getComponent(EntityFormShell).vm.$emit('back')
  await flushPromises()
  expect(f.confirmed).toHaveBeenCalledTimes(1)
  expect(f.router.currentRoute.value.fullPath).toBe('/material/quotations/form')
  expect(f.page().vm.$.uid).toBe(instance)
  await form.getComponent(FormFooter).findAll('button').find(button => button.text() === '保存')!.trigger('click')
  await flushPromises()
  expect(f.commands[1]).toMatchObject({ id: 'saved-record-one', baseVersion: '1', draft: { partyName: '后来尚未提交的报价方' }, attachments: { add: [{ fileName: '后来B.txt', payloadBase64: 'Qg==' }] } })
  expect(f.commands).toHaveLength(2)
  expect(f.commands[0]).toMatchObject({ baseVersion: null, attachments: { add: [{ fileName: '原件A.txt', payloadBase64: 'QQ==' }] } })
  expect(f.commands[1]!.commandId).not.toBe(f.commands[0]!.commandId)
  expect(f.router.currentRoute.value.fullPath).toBe('/material/quotations/form/saved-record-one')
  expect(f.repository.loadForm).toHaveBeenLastCalledWith('saved-record-one')
  expect(f.page().get('[data-testid="quotation-party"]').element.value).toBe('后来尚未提交的报价方')
  expect(f.confirmed).toHaveBeenCalledTimes(1)
})
