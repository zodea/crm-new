import type { SupplierCredentialTarget } from '~/lib/supplier/credential-state'
import { defineStore } from 'pinia'
import { createSupplierCredentialState } from '~/lib/supplier/credential-state'

export const useSupplierCredentialStore = defineStore('supplier-credential', () => {
  const repository = useNuxtApp().$repositories.supplierCredentials
  return {
    createSession: (target: () => SupplierCredentialTarget) => createSupplierCredentialState(repository, target),
  }
})
