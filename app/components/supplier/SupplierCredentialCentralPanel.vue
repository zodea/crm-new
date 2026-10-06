<script setup lang="ts">
import type { SupplierCredentialAction, SupplierCredentialAudit, SupplierCredentialRecord, SupplierCredentialRequirementRecord } from '~/lib/supplier/credential-contract'
import type { SupplierCredentialEditorMode, SupplierCredentialFormValue } from '~/lib/supplier/credential-form'
import type { SupplierCredentialBaseline } from '~/lib/supplier/credential-state'
import type { DataOriginDTO } from '~/types/read-model'
import { useObjectUrl } from '@vueuse/core'
import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, reactive, shallowRef, watch } from 'vue'
import { onBeforeRouteUpdate } from 'vue-router'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '~/components/ui/dialog'
import EntityDetailShell from '~/components/ui/EntityDetailShell.vue'
import { useTabCloseGuard } from '~/composables/useTabCloseGuard'
import { bindReadAuthority } from '~/lib/read-model/authority'
import { assertSupplierCredentialUpload } from '~/lib/supplier/credential-files'
import { emptySupplierCredentialForm } from '~/lib/supplier/credential-form'
import { credentialContentBytes } from '~/lib/supplier/credential-repository'
import { credentialExpiryState } from '~/lib/supplier/credentials'
import { SupplierRepositoryProblem } from '~/lib/supplier/read-contract'
import { validateSupplierDetailReturnTo, validateSupplierReturnTo } from '~/lib/supplier/return-context'
import { CREDENTIAL_STATUS_LABEL } from '~/lib/supplier/status'
import { formatShanghaiDateTime } from '~/lib/util/datetime'
import { useSupplierCredentialStore } from '~/stores/supplier-credential'
import SupplierCredentialEditor from './SupplierCredentialEditor.vue'
import SupplierCredentialOcrWorkflow from './SupplierCredentialOcrWorkflow.vue'
import SupplierCredentialOriginalList from './SupplierCredentialOriginalList.vue'
import SupplierCredentialRequirements from './SupplierCredentialRequirements.vue'
import SupplierCredentialReviewStatus from './SupplierCredentialReviewStatus.vue'

const props = defineProps<{ supplierId: string, origin: DataOriginDTO, returnTo?: string }>()
const detailShell = shallowRef<InstanceType<typeof EntityDetailShell> | null>(null)
const visibility = useDataVisibilityStore()
const { confirm, success, warning } = useKitUI()
const active = shallowRef(true)
const session = useSupplierCredentialStore().createSession(() => ({ supplierId: props.supplierId, origin: props.origin, enabled: active.value && (props.origin !== 'demo' || visibility.includeDemo) }))
const { data, loading, saving, error, errorCode, conflict, canWrite } = session
const mode = shallowRef<SupplierCredentialEditorMode | null>(null)
const form = reactive(emptySupplierCredentialForm())
const selectedFile = shallowRef<File | null>(null)
const selectedRecord = shallowRef<SupplierCredentialRecord | null>(null)
const selectedAudit = shallowRef<SupplierCredentialAudit | null>(null)
const baseline = shallowRef<SupplierCredentialBaseline | null>(null)
const pendingAction = shallowRef<SupplierCredentialAction | null>(null)
const editorError = shallowRef('')
const rechecked = shallowRef(false)
const preparing = shallowRef(false)
const previewBlob = shallowRef<Blob | null>(null)
const previewName = shallowRef('')
const previewCloseButton = shallowRef<HTMLButtonElement | null>(null)
const previewUrl = useObjectUrl(previewBlob)
const fileBusy = shallowRef(false)
const ocrRecordId = shallowRef('')
const ocrRecognizeOnOpen = shallowRef(false)
const ocrPreparing = shallowRef(false)
watch(session.recoveryNotice, (notice) => {
  if (notice && active.value) {
    resetEditor()
    ocrRecordId.value = ''
    ocrPreparing.value = false
  }
})
const ocrWorkflow = shallowRef<InstanceType<typeof SupplierCredentialOcrWorkflow> | null>(null)
const fileError = shallowRef('')
bindReadAuthority(problem => session.invalidate(problem))
let epoch = 0
watch(errorCode, (code) => {
  if (['unauthenticated', 'forbidden'].includes(code) || (code === 'unavailable' && !data.value)) {
    ++epoch
    previewBlob.value = null
    previewName.value = ''
    selectedRecord.value = null
    selectedAudit.value = null
    ocrRecordId.value = ''
    fileError.value = ''
  }
})
const downloadUrls = new Set<string>()
let initialForm = ''
let deactivated = false
let editorTrigger: HTMLElement | null = null
let previewTrigger: HTMLElement | null = null
let ocrTrigger: HTMLElement | null = null
const busy = computed(() => saving.value || preparing.value || fileBusy.value || ocrPreparing.value)
const dirty = computed(() => mode.value !== null && (pendingAction.value !== null || selectedFile.value !== null || JSON.stringify(form) !== initialForm))
const currentFileName = computed(() => selectedFile.value?.name ?? selectedRecord.value?.file?.fileName ?? selectedRecord.value?.category ?? '')
const missing = computed(() => {
  const current = data.value
  if (!current)
    return []
  const now = new Date(`${current.businessDate}T12:00:00+08:00`)
  return current.requirements.filter(row => row.requirement === 'required' && !current.credentials.some(record => record.category === row.category && record.file?.state === 'available' && credentialExpiryState(record, now) !== 'expired')).map(row => row.category)
})
const restorableAudits = computed(() => data.value?.audits.filter(row => row.canRestore) ?? [])
const unavailableIntent = computed(() => {
  if (!data.value || !canWrite.value)
    return '当前资料或写入权限不可用，请重新读取后核对'
  if (pendingAction.value)
    return ''
  if (mode.value === 'review' && data.value.status !== 'reviewing')
    return '当前资料已不处于齐全待核验，请先完成所需资料后再核验'
  if (['edit', 'delete'].includes(mode.value ?? '') && !data.value.credentials.some(row => row.id === selectedRecord.value?.id))
    return '这份证照已不在当前清单，请取消后核对最新资料'
  if (mode.value === 'restore' && !restorableAudits.value.some(row => row.id === selectedAudit.value?.id && row.deletionToken === selectedAudit.value.deletionToken))
    return '本次删除已不能撤回，请取消后核对最新资料'
  return ''
})
const recheckSummary = computed(() => {
  const current = data.value
  if (!rechecked.value || !current)
    return []
  const result = [`当前资料状态：${CREDENTIAL_STATUS_LABEL[current.status]}`, `原件清单：${current.credentials.length} 份`, missing.value.length ? `缺失或过期：${missing.value.join('、')}` : '需提供资料已齐全']
  const record = current.credentials.find(row => row.id === selectedRecord.value?.id)
  if (record)
    result.push(`当前证照：${record.category}；生效 ${record.validFrom || '未登记'}；${record.longTerm ? '长期有效' : `到期 ${record.expiresAt || '未登记'}`}`)
  if (mode.value === 'requirement') {
    const requirement = current.requirements.find(row => row.category === form.category)
    if (requirement)
      result.push(`当前要求：${requirement.requirement === 'required' ? '需提供' : requirement.requirement === 'optional' ? '可选' : '不适用'}；原因 ${requirement.reason || '未填写'}`)
  }
  return result
})
const backTo = computed(() => {
  const detailReturn = validateSupplierDetailReturnTo(props.returnTo, props.origin, props.supplierId)
  if (detailReturn)
    return detailReturn
  const query = new URLSearchParams({ origin: props.origin })
  const parent = validateSupplierReturnTo(props.returnTo)
  if (parent)
    query.set('returnTo', parent)
  return `/base/supplier/${encodeURIComponent(props.supplierId)}?${query.toString()}`
})
const shellState = computed(() => loading.value && !data.value ? 'loading' : data.value ? 'ready' : ['unauthenticated', 'forbidden'].includes(errorCode.value) ? 'forbidden' : ['not-found', 'relationship-mismatch'].includes(errorCode.value) ? 'not-found' : 'error')
const stateTitle = computed(() => errorCode.value === 'unauthenticated' ? '登录已失效，请重新登录' : errorCode.value === 'forbidden' ? '无权查看此来源的证照' : errorCode.value === 'relationship-mismatch' ? '证照来源或归属不匹配' : errorCode.value === 'not-found' ? '分供方不存在或已删除' : loading.value ? '正在加载证照原件' : '证照原件读取失败')
useTabTitle(() => data.value ? `${data.value.supplierName} · 证照附件` : '分供方证照附件')

async function load(focusTitle = false) {
  const currentEpoch = epoch
  try {
    await session.load()
    if (focusTitle && active.value && currentEpoch === epoch && data.value && !mode.value && !ocrRecordId.value) {
      await nextTick()
      detailShell.value?.$el.querySelector?.('[data-entity-detail-title]')?.focus({ preventScroll: true })
    }
  }
  catch { /* 当前读取错误由状态面板展示；取消请求不影响其他页签。 */ }
}
function resetEditor() {
  epoch++
  mode.value = null
  selectedFile.value = null
  selectedRecord.value = null
  selectedAudit.value = null
  baseline.value = null
  pendingAction.value = null
  editorError.value = ''
  rechecked.value = false
  Object.assign(form, emptySupplierCredentialForm())
}
function openEditor(next: SupplierCredentialEditorMode, record?: SupplierCredentialRecord, requirement?: SupplierCredentialRequirementRecord, decision?: 'qualified' | 'rejected', audit?: SupplierCredentialAudit) {
  if (!canWrite.value || busy.value || ocrRecordId.value)
    return
  resetEditor()
  editorTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  selectedRecord.value = record ?? null
  selectedAudit.value = audit ?? null
  if (record)
    Object.assign(form, { category: record.category, validFrom: record.validFrom, expiresAt: record.expiresAt, longTerm: record.longTerm })
  if (requirement)
    Object.assign(form, { category: requirement.category, requirement: requirement.requirement, reason: requirement.reason })
  if (decision)
    form.decision = decision
  baseline.value = session.baseline()
  initialForm = JSON.stringify(form)
  mode.value = next
}
function patchForm(patch: Partial<SupplierCredentialFormValue>) {
  if (!busy.value && !pendingAction.value && !conflict.value)
    Object.assign(form, patch)
}
async function mayClose() {
  if (ocrWorkflow.value && !await ocrWorkflow.value.mayClose())
    return false
  if (busy.value)
    return false
  if (!dirty.value)
    return true
  const currentEpoch = epoch
  const approved = await confirm({ variant: 'simple', title: '放弃未保存的证照输入？', message: pendingAction.value ? '上次提交可能已保存，重新进入后请核对原件清单。关闭会放弃当前保留的输入。' : '当前输入尚未保存，确认放弃后再关闭。', confirmLabel: '放弃输入' })
  return approved && currentEpoch === epoch
}
function openOcr(record: SupplierCredentialRecord, recognize: boolean) {
  if (busy.value || mode.value || ocrRecordId.value)
    return
  ocrTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  ocrRecognizeOnOpen.value = recognize
  ocrRecordId.value = record.id
}
async function closeOcr() {
  ocrRecordId.value = ''
  ocrPreparing.value = false
  await nextTick()
  if (active.value && ocrTrigger?.isConnected)
    ocrTrigger.focus()
}
async function closeEditor() {
  if (!await mayClose())
    return
  resetEditor()
  await nextTick()
  if (active.value && editorTrigger?.isConnected)
    editorTrigger.focus()
}
useTabCloseGuard(mayClose)
onBeforeRouteUpdate(async (to, from) => {
  if (to.path !== from.path || to.query.origin === from.query.origin)
    return true
  return mayClose()
})

async function actionFor(): Promise<SupplierCredentialAction> {
  const validity = { category: form.category, validFrom: form.validFrom, expiresAt: form.longTerm ? '' : form.expiresAt, longTerm: form.longTerm }
  if (mode.value === 'upload') {
    const file = selectedFile.value
    if (!file)
      throw new Error('请选择需要保存的证照原件')
    await assertSupplierCredentialUpload(file)
    const bytes = new Uint8Array(await file.arrayBuffer())
    const chunks: string[] = []
    for (let index = 0; index < bytes.length; index += 0x8000)
      chunks.push(String.fromCharCode(...bytes.subarray(index, index + 0x8000)))
    return { action: 'upload', draft: { ...validity, fileName: file.name, fileSize: file.size, mimeType: file.type, payloadBase64: btoa(chunks.join('')) } }
  }
  if (mode.value === 'edit' && selectedRecord.value)
    return { action: 'edit', credentialId: selectedRecord.value.id, draft: validity }
  if (mode.value === 'requirement')
    return { action: 'requirement', draft: { category: form.category, requirement: form.requirement, reason: form.reason.trim() } }
  if (mode.value === 'review') {
    if (form.decision === 'rejected' && !form.note.trim())
      throw new Error('请填写退回原因')
    return { action: 'review', draft: { decision: form.decision, note: form.note.trim() } }
  }
  if (mode.value === 'delete' && selectedRecord.value)
    return { action: 'delete', credentialId: selectedRecord.value.id }
  if (mode.value === 'restore' && selectedAudit.value?.credentialId && selectedAudit.value.deletionToken)
    return { action: 'restore', credentialId: selectedAudit.value.credentialId, auditId: selectedAudit.value.id, deletionToken: selectedAudit.value.deletionToken }
  throw new Error('当前操作目标已失效，请重新选择')
}
async function submit() {
  if (busy.value || conflict.value || !canWrite.value || unavailableIntent.value)
    return
  const currentEpoch = epoch
  preparing.value = true
  editorError.value = ''
  try {
    const action = pendingAction.value ?? await actionFor()
    if (currentEpoch !== epoch || !active.value)
      return
    pendingAction.value = action
    preparing.value = false
    await session.execute(action, baseline.value)
    if (currentEpoch !== epoch || !active.value)
      return
    resetEditor()
    success(action.action === 'delete' ? '证照已删除，可从删除记录撤回本次操作' : action.action === 'restore' ? '已恢复同一份证照原件' : '证照资料已保存并重新读取')
    await nextTick()
    if (editorTrigger?.isConnected)
      editorTrigger.focus()
  }
  catch (cause) {
    if (currentEpoch === epoch && active.value) {
      editorError.value = cause instanceof Error ? cause.message : '证照资料保存失败'
      if (conflict.value || (cause instanceof SupplierRepositoryProblem && !['unavailable', 'internal-error'].includes(cause.problem.code)))
        pendingAction.value = null
    }
  }
  finally { preparing.value = false }
}
async function recheck() {
  if (busy.value)
    return
  const currentEpoch = epoch
  const recoveringOriginal = pendingAction.value !== null
  preparing.value = true
  try {
    const next = await session.recheck()
    if (currentEpoch !== epoch || !active.value)
      return
    if (!recoveringOriginal) {
      baseline.value = next
      pendingAction.value = null
    }
    editorError.value = ''
    rechecked.value = true
    warning(recoveringOriginal ? '已重新读取当前资料，请恢复原提交以确认上次保存结果' : '已重新读取当前资料，请核对保留的输入后再次保存')
  }
  catch (cause) {
    if (currentEpoch === epoch)
      editorError.value = cause instanceof Error ? cause.message : '重新核对失败'
  }
  finally { preparing.value = false }
}
async function accessFile(record: SupplierCredentialRecord, download: boolean) {
  if (fileBusy.value)
    return
  if (!download)
    previewTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const currentEpoch = epoch
  fileBusy.value = true
  fileError.value = ''
  try {
    const content = await session.file(record.id)
    if (currentEpoch !== epoch || !active.value)
      return
    const bytes = credentialContentBytes(content)
    const blob = new Blob([bytes.slice().buffer], { type: content.mimeType })
    if (download) {
      const url = URL.createObjectURL(blob)
      downloadUrls.add(url)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = content.fileName || '证照原件'
      anchor.click()
      window.setTimeout(() => {
        URL.revokeObjectURL(url)
        downloadUrls.delete(url)
      }, 1000)
    }
    else {
      previewName.value = content.fileName
      previewBlob.value = blob
    }
  }
  catch (cause) {
    if (currentEpoch === epoch && active.value)
      fileError.value = cause instanceof Error ? cause.message : '证照原件读取失败'
  }
  finally { fileBusy.value = false }
}
function focusPreviewClose(event: Event) {
  event.preventDefault()
  previewCloseButton.value?.focus()
}
function restorePreviewFocus(event: Event) {
  event.preventDefault()
  if (active.value && previewTrigger?.isConnected)
    previewTrigger.focus()
}
watch(() => [props.supplierId, props.origin, props.origin === 'demo' ? visibility.includeDemo : true], () => {
  resetEditor()
  ocrRecordId.value = ''
  ocrPreparing.value = false
  previewBlob.value = null
  if (active.value)
    void load(true)
}, { immediate: true })
onDeactivated(() => {
  active.value = false
  deactivated = true
  epoch++
  session.cancelRead()
  previewBlob.value = null
})
onActivated(() => {
  active.value = true
  if (deactivated) {
    deactivated = false
    void load(true)
  }
})
onScopeDispose(() => {
  active.value = false
  epoch++
  session.cancelRead()
  for (const url of downloadUrls)
    URL.revokeObjectURL(url)
})
</script>

<template>
  <EntityDetailShell ref="detailShell" :title="data ? `${data.supplierName} · 证照附件` : '分供方证照附件'" subtitle="原件、资料要求和人工核验结果统一保存在当前分供方。" :back-to="backTo" back-label="返回分供方详情" :state="shellState" :state-title="stateTitle" :state-description="error" :state-action-label="shellState === 'error' ? '重新加载' : ''" @state-action="load(true)">
    <div v-if="data" class="grid min-w-0 gap-4">
      <p v-if="session.recoveryNotice.value" class="m-0 border border-brand/25 bg-brand-soft p-3 text-12px leading-5 text-brand" role="status">
        {{ session.recoveryNotice.value }}
      </p>
      <p v-if="origin === 'demo'" class="m-0 text-12px text-ink-soft">
        测试证照只读，原件按当前测试身份读取。
      </p>
      <SupplierCredentialReviewStatus :status="data.status" :review="data.review" :review-current="data.reviewCurrent" :review-history="data.reviewHistory" :can-write="canWrite && !busy" @review="openEditor('review', undefined, undefined, $event)" />
      <SupplierCredentialRequirements :requirements="data.requirements" :can-write="canWrite && !busy" @edit="openEditor('requirement', undefined, $event)" />
      <p v-if="missing.length" class="m-0 border border-warn/30 bg-warn-soft p-3 text-12px leading-5 text-warn-ink" role="status">
        缺失或已过期的需提供资料：{{ missing.join('、') }}
      </p>
      <div v-if="fileError" class="border border-danger/30 bg-danger-soft p-3 text-12px leading-5 text-danger-ink" role="alert">
        {{ fileError }}
      </div>
      <SupplierCredentialOriginalList :credentials="data.credentials" :business-date="data.businessDate" :can-write="canWrite" :busy="busy || Boolean(ocrRecordId)" @upload="openEditor('upload')" @edit="openEditor('edit', $event)" @remove="openEditor('delete', $event)" @preview="accessFile($event, false)" @download="accessFile($event, true)" @recognize="openOcr($event, true)" @review-ocr="openOcr($event, false)" />
      <section v-if="restorableAudits.length" class="panel p-4" aria-label="可撤回的证照删除记录">
        <h3 class="m-0 text-13px font-700 text-ink">
          删除记录
        </h3>
        <ul class="mb-0 mt-2 grid list-none gap-2 p-0">
          <li v-for="audit in restorableAudits" :key="audit.id" class="flex flex-wrap items-center gap-2 text-12px text-ink-soft">
            <span class="mr-auto">{{ audit.categoryBefore || '证照' }} · {{ formatShanghaiDateTime(audit.createdAt, '历史时间未知') }}</span>
            <button v-if="canWrite" type="button" class="btn-secondary" :disabled="busy" @click="openEditor('restore', undefined, undefined, undefined, audit)">
              撤回本次删除
            </button>
          </li>
        </ul>
      </section>
    </div>
  </EntityDetailShell>
  <SupplierCredentialEditor v-if="mode && active" :mode="mode" :value="form" :file-name="currentFileName" :busy="busy" :locked="pendingAction !== null" :error="editorError" :conflict="conflict" :unavailable="unavailableIntent" :recheck-summary="recheckSummary" @patch="patchForm" @file="selectedFile = $event" @submit="submit" @cancel="closeEditor" @recheck="recheck" />
  <SupplierCredentialOcrWorkflow v-if="ocrRecordId" :key="`${supplierId}:${origin}:${ocrRecordId}`" ref="ocrWorkflow" :session="session" :credential-id="ocrRecordId" :active="active" :recognize-on-open="ocrRecognizeOnOpen" @close="closeOcr" @busy="ocrPreparing = $event" />
  <Dialog
    :open="Boolean(previewBlob) && active" @update:open="open => {
      if (!open) previewBlob = null
    }"
  >
    <DialogContent :show-close="false" class="flex max-h-[90dvh] w-[min(64rem,calc(100vw-2rem))] flex-col p-4" @open-auto-focus="focusPreviewClose" @close-auto-focus="restorePreviewFocus">
      <div class="flex min-w-0 items-start gap-3">
        <DialogTitle class="min-w-0 flex-1 break-words">
          {{ previewName }}
        </DialogTitle>
        <button ref="previewCloseButton" type="button" class="btn-secondary shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand" @click="previewBlob = null">
          关闭
        </button>
      </div>
      <DialogDescription class="m-0 text-12px text-ink-soft">
        当前分供方的证照原件
      </DialogDescription>
      <iframe v-if="previewBlob?.type === 'application/pdf' && previewUrl" :src="previewUrl" title="证照 PDF 原件预览" class="mt-3 h-[65dvh] min-h-0 w-full border border-line" />
      <img v-else-if="previewUrl" :src="previewUrl" :alt="previewName" class="mt-3 max-h-[65dvh] min-h-0 object-contain">
    </DialogContent>
  </Dialog>
</template>
