<script setup lang="ts">
import type { SupplierDetailSnapshot } from '~/stores/supplier-detail'
import type { DataOriginDTO } from '~/types/read-model'
import { isTauri } from '@tauri-apps/api/core'
import { computed, shallowRef, watch } from 'vue'
import { validateSupplierDetailReturnTo, validateSupplierReturnTo } from '~/lib/supplier/return-context'
import SupplierCredentialCentralPanel from './SupplierCredentialCentralPanel.vue'

const props = defineProps<{ supplierId: string, origin: DataOriginDTO, returnTo?: string }>()
const desktop = isTauri()
const supplierStore = desktop ? useSupplierStore() : null
const detailStore = desktop ? useSupplierDetailStore() : null
const snapshot = shallowRef<SupplierDetailSnapshot | null>(null)
const supplierName = shallowRef('')
const loadError = shallowRef('')
const state = shallowRef<'ready' | 'loading' | 'not-found' | 'error'>('loading')
let sequence = 0
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

async function loadDesktop() {
  if (!desktop || !supplierStore || !detailStore)
    return
  const request = ++sequence
  const id = props.supplierId
  state.value = 'loading'
  snapshot.value = null
  supplierName.value = ''
  loadError.value = ''
  if (props.origin !== 'real') {
    state.value = 'not-found'
    loadError.value = '桌面本地证照只接受正式本地身份，不能用测试来源访问。'
    return
  }
  try {
    await supplierStore.load()
    if (request !== sequence)
      return
    const supplier = supplierStore.byId(id)
    if (!supplier) {
      state.value = 'not-found'
      return
    }
    await detailStore.load(id)
    if (request !== sequence)
      return
    supplierName.value = supplier.name
    snapshot.value = detailStore.bySupplier(id)
    state.value = 'ready'
  }
  catch (cause) {
    if (request === sequence) {
      loadError.value = cause instanceof Error ? cause.message : '证照附件加载失败'
      state.value = 'error'
    }
  }
}
if (desktop) {
  useTabTitle(() => supplierName.value ? `${supplierName.value} · 证照附件` : '分供方证照附件')
  watch(() => [props.supplierId, props.origin], () => void loadDesktop(), { immediate: true })
}
</script>

<template>
  <SupplierCredentialCentralPanel v-if="!desktop" :supplier-id="supplierId" :origin="origin" :return-to="returnTo" />
  <EntityDetailShell v-else :title="supplierName ? `${supplierName} · 证照附件` : '分供方证照附件'" subtitle="证照原件、OCR、有效期、资料要求与人工核验。" :back-to="backTo" back-label="返回分供方详情" :state="state" :state-description="loadError" :state-action-label="state === 'error' ? '重新加载' : ''" @state-action="loadDesktop">
    <SupplierCredentialTab v-if="state === 'ready' && snapshot" :supplier-id="supplierId" :snapshot="snapshot" />
  </EntityDetailShell>
</template>
