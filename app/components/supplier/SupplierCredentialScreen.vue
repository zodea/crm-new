<script setup lang="ts">
import type { SupplierDetailSnapshot } from '~/stores/supplier-detail'
import type { DataOriginDTO } from '~/types/read-model'
import { isTauri } from '@tauri-apps/api/core'
import { computed, nextTick, shallowRef, watch } from 'vue'
import { validateSupplierReturnTo } from '~/lib/supplier/return-context'
import { toErrorMessage } from '~/lib/util/error'
import { useSupplierReadStore } from '~/stores/supplier-read'

const props = defineProps<{
  supplierId: string
  origin: DataOriginDTO
  returnTo?: string
}>()

const desktop = isTauri()
const dataVisibilityStore = useDataVisibilityStore()
const centralStore = useSupplierReadStore()
const supplierStore = useSupplierStore()
const detailStore = useSupplierDetailStore()
const loadError = shallowRef('')
const retryable = shallowRef(false)
const stateTitleOverride = shallowRef('')
const mode = shallowRef<'writable' | 'readonly' | 'unavailable'>('unavailable')
const localSnapshot = shallowRef<SupplierDetailSnapshot | null>(null)
const localSupplierName = shallowRef('')
const centralDetail = computed(() => centralStore.detailState.kind === 'ready' ? centralStore.detailState.data : null)
const supplierName = computed(() => centralDetail.value?.supplier.name ?? localSupplierName.value)
const snapshot = computed(() => localSnapshot.value)
const backTo = computed(() => {
  const query = new URLSearchParams({ origin: props.origin })
  const returnTo = validateSupplierReturnTo(props.returnTo)
  if (returnTo)
    query.set('returnTo', returnTo)
  return `/base/supplier/${encodeURIComponent(props.supplierId)}?${query.toString()}`
})
const shellState = shallowRef<'ready' | 'loading' | 'not-found' | 'forbidden' | 'error'>('loading')
const stateTitle = computed(() => {
  if (stateTitleOverride.value)
    return stateTitleOverride.value
  if (shellState.value === 'loading')
    return '正在加载证照附件'
  if (shellState.value === 'forbidden')
    return '无权查看该分供方证照'
  if (shellState.value === 'not-found')
    return '分供方不存在或来源不匹配'
  if (mode.value === 'unavailable')
    return '中央证照专用存储尚未接入'
  return '证照附件加载失败'
})

useTabTitle(() => supplierName.value ? `${supplierName.value} · 证照附件` : '分供方证照附件')

async function load() {
  shellState.value = 'loading'
  loadError.value = ''
  retryable.value = false
  stateTitleOverride.value = ''
  localSnapshot.value = null
  localSupplierName.value = ''
  mode.value = 'unavailable'
  try {
    if (desktop) {
      if (props.origin !== 'real') {
        shellState.value = 'not-found'
        loadError.value = '桌面本地证照只接受正式本地身份，不能用测试来源访问。'
        return
      }
      await supplierStore.load()
      const supplier = supplierStore.byId(props.supplierId)
      if (!supplier) {
        shellState.value = 'not-found'
        return
      }
      await detailStore.load(props.supplierId)
      localSupplierName.value = supplier.name
      localSnapshot.value = detailStore.bySupplier(props.supplierId)
      mode.value = 'writable'
      shellState.value = 'ready'
      return
    }

    if (props.origin === 'demo' && !dataVisibilityStore.includeDemo) {
      shellState.value = 'not-found'
      stateTitleOverride.value = '测试数据未开启'
      loadError.value = '请先从应用顶栏显式开启测试数据并通过查看权限核验。'
      return
    }

    await centralStore.loadDetail({
      id: props.supplierId,
      origin: props.origin,
      includeDemo: dataVisibilityStore.includeDemo,
    })
    if (centralStore.detailState.kind === 'forbidden') {
      shellState.value = 'forbidden'
      loadError.value = centralStore.detailState.problem.message
      return
    }
    if (centralStore.detailState.kind === 'not-found' || centralStore.detailState.kind === 'mismatch') {
      shellState.value = 'not-found'
      loadError.value = centralStore.detailState.problem.message
      return
    }
    if (centralStore.detailState.kind !== 'ready') {
      shellState.value = 'error'
      loadError.value = 'problem' in centralStore.detailState ? centralStore.detailState.problem.message : '中央分供方读取失败'
      retryable.value = 'problem' in centralStore.detailState && centralStore.detailState.problem.retryable
      return
    }
    if (props.origin === 'real') {
      shellState.value = 'ready'
      loadError.value = '正式主档仍由中央 Repository 管理；当前不会读取或写入浏览器旧本地证照库。'
      return
    }

    await supplierStore.load()
    if (!supplierStore.byId(props.supplierId)) {
      shellState.value = 'not-found'
      loadError.value = '测试身份已由中央确认，但本地只读证照快照不存在。'
      return
    }
    await detailStore.loadReadonlySnapshot(props.supplierId)
    localSnapshot.value = detailStore.bySupplier(props.supplierId)
    mode.value = 'readonly'
    shellState.value = 'ready'
  }
  catch (cause) {
    loadError.value = toErrorMessage(cause)
    shellState.value = 'error'
    retryable.value = true
  }
  finally {
    await nextTick()
    document.querySelector<HTMLElement>('[data-entity-detail-title]')?.focus({ preventScroll: true })
  }
}

watch(() => [props.supplierId, props.origin, dataVisibilityStore.includeDemo], () => void load(), { immediate: true })
</script>

<template>
  <EntityDetailShell
    :title="supplierName ? `${supplierName} · 证照附件` : '分供方证照附件'"
    subtitle="证照原件、OCR、有效期、资料要求与人工核验使用独立文件/审计边界。"
    :back-to="backTo"
    back-label="返回分供方详情"
    :state="shellState"
    :state-title="stateTitle"
    :state-description="loadError"
    :state-action-label="shellState === 'error' && retryable ? '重新加载' : ''"
    @state-action="load"
  >
    <SupplierCredentialTab
      v-if="shellState === 'ready' && mode === 'writable' && snapshot"
      :supplier-id="supplierId"
      :snapshot="snapshot"
    />
    <section v-else-if="shellState === 'ready' && mode === 'readonly' && snapshot" class="panel min-w-0 overflow-hidden" aria-labelledby="supplier-credential-readonly-heading">
      <div class="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h2 id="supplier-credential-readonly-heading" class="m-0 mr-auto text-14px font-800 text-ink">
          证照快照
        </h2>
        <span class="chip">测试证照只读</span>
      </div>
      <StatePanel v-if="snapshot.credentials.length === 0" kind="empty" title="暂无测试证照" description="这是中央测试身份对应的只读本地证照快照。" compact />
      <ul v-else class="m-0 grid list-none gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3" data-ui="supplier-credential-readonly-list">
        <li v-for="credential in snapshot.credentials" :key="credential.id" class="min-w-0 rounded-[var(--radius-card)] border border-line bg-surface-1 p-3">
          <div class="flex min-w-0 items-center gap-2">
            <strong class="min-w-0 truncate text-13px text-ink">{{ credential.category }}</strong>
            <span class="chip ml-auto flex-none">{{ credential.ocrReviewStatus === 'confirmed' ? '已核对' : credential.ocrReviewStatus === 'pending' ? '待核对' : '未识别' }}</span>
          </div>
          <p class="mt-2 truncate text-12px text-ink-muted" :title="credential.fileName">
            {{ credential.fileName || '未保存文件名' }}
          </p>
          <p class="mb-0 mt-1 text-11px text-ink-faint">
            {{ credential.longTerm ? '长期有效' : credential.expiresAt ? `有效至 ${credential.expiresAt}` : '未登记有效期' }}
          </p>
        </li>
      </ul>
    </section>
    <StatePanel
      v-else-if="shellState === 'ready' && mode === 'unavailable'"
      kind="error"
      title="中央证照专用存储尚未接入"
      :description="loadError"
    />
  </EntityDetailShell>
</template>
