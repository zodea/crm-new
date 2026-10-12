import type { DeliveryAmountSource } from '~/lib/delivery/review'
import type { DataOriginDTO } from '~/types/read-model'
import { defineStore } from 'pinia'

import { createDeliveryRecordState } from '~/lib/delivery-record/state'
import { useDataVisibilityStore } from '~/stores/data-visibility'

export interface DeliveryLineDraft {
  id?: string
  materialName: string
  spec: string
  unit: string
  qty: number | null
  unitPrice: number | null
  amount?: number | null
  amountSource?: DeliveryAmountSource
  note: string
}

export interface DeliveryLine extends Omit<DeliveryLineDraft, 'amount' | 'amountSource'> {
  id: string
  deliveryRecordId: string
  amount: number | null
  amountSource: DeliveryAmountSource
  currentValueConfirmed: boolean
  sortOrder: number
}

export type DeliveryPrintDisposition = 'pending' | 'printed' | 'excluded'

export interface DeliveryRecord {
  id: string
  dataOrigin?: DataOriginDTO
  version?: string
  assetId?: string | null
  projectName?: string
  supplierName?: string
  legacyAudit?: string | null
  projectId: string
  supplierId: string | null
  rawSiteText: string
  orderNo: string
  deliveryDate: string
  fileName: string
  filePath: string
  ocrStatus: string
  reviewStatus: 'reviewed' | 'unreviewed'
  naturalKeyDuplicate: boolean
  currentValuesConfirmed: boolean
  archived: boolean
  stored: boolean
  printBatchId: string
  printDisposition: DeliveryPrintDisposition
  printedAt: string
  printExcludedAt: string
  reviewFlag: string
  note: string
  createdAt: string
  updatedAt: string
  hasSourceFile: boolean
  lines: readonly DeliveryLine[]
  totalAmount: number
}

export interface DeliveryRecordInput {
  projectId: string
  supplierId: string | null
  orderNo: string
  deliveryDate: string
  note: string
  reviewFlag?: string
  rawSiteText?: string
  fileName?: string
  filePath?: string
  printBatchId?: string
  confirmations?: DeliveryRecordConfirmations
  lines: DeliveryLineDraft[]
}

export interface DeliveryRecordConfirmations {
  noOrderNoConfirmed?: boolean
  pricePendingConfirmed?: boolean
  amountReviewed?: boolean
}

export interface DeliveryRecordSourceFile {
  fileName: string
  mimeType: string
  fileSize: number
  bytes: Uint8Array
}

export const useDeliveryRecordStore = defineStore('delivery-record-central', () => {
  const repositories = useNuxtApp().$repositories
  const visibility = useDataVisibilityStore()
  return createDeliveryRecordState(repositories.deliveries, () => visibility.includeDemo ? 'demo' : 'real')
})
