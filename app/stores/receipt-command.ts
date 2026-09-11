import { defineStore } from 'pinia'
import { createReceiptCommandActions } from '~/lib/receipt/command-session'

export const useReceiptCommandStore = defineStore('receipt-command', () => {
  const repository = useNuxtApp().$repositories.receipts
  return createReceiptCommandActions(() => repository)
})
