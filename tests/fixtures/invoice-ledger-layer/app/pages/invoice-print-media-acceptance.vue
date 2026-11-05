<script setup lang="ts">
import type { CentralInvoiceRecord } from '~/lib/invoice/central-contract'
import CentralInvoiceLedgerScreen from '~/components/invoice/CentralInvoiceLedgerScreen.vue'

const scan: CentralInvoiceRecord = {
  id: 'media-scan',
  version: '1',
  sourceKind: 'scan',
  fields: { invoiceNumber: 'MEDIA-SCAN', invoiceDate: '2026-01-01', invoiceType: '', buyer: '', buyerTaxNo: '', seller: '合成销方', sellerTaxNo: '', amount: null, taxAmount: null, totalAmount: 100, taxRate: '', remark: '' },
  items: [],
  unrecognizedPageIndexes: [],
  ocrStatus: 'done',
  completionMethod: 'ocr',
  reviewStatus: 'reviewed',
  accountStatus: 'archived',
  duplicateStatus: 'normal',
  printCount: 0,
  printRotation: 0,
  ownerKind: 'personal',
  projectId: null,
  supplierId: null,
  contract: null,
  archivedAt: '2026-01-01T00:00:00.000Z',
  original: { id: 'media-original', fileName: '合成.pdf', fileSize: 100, mimeType: 'application/pdf', sha256: 'a'.repeat(64) },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}
const excel: CentralInvoiceRecord = { ...scan, id: 'media-excel', sourceKind: 'excel', original: null, fields: { ...scan.fields, invoiceNumber: 'MEDIA-EXCEL', totalAmount: null } }
let releaseOriginal: (() => void) | null = null
const workspace = {
  records: shallowRef([scan, excel]),
  loading: shallowRef(false),
  readState: shallowRef<'ready' | 'loading'>('ready'),
  pendingPrint: () => null,
  load: async () => {
    workspace.readState.value = 'loading'
    await new Promise(resolve => setTimeout(resolve, 0))
    workspace.readState.value = 'ready'
  },
  verifiedOriginal: async () => new Promise<Blob>((resolve) => { releaseOriginal = () => resolve(new Blob()) }),
  recordPrinted: async () => {},
}
onMounted(() => {
  ;(window as unknown as { releaseInvoiceMediaOriginal: () => void }).releaseInvoiceMediaOriginal = () => releaseOriginal?.()
})
</script>

<template>
  <CentralInvoiceLedgerScreen :workspace="workspace as never" :projects="[]" />
</template>
