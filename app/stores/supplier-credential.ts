import type { SupplierCredentialTarget } from '~/lib/supplier/credential-state'
import { defineStore } from 'pinia'
import { createSupplierCredentialState } from '~/lib/supplier/credential-state'

export const useSupplierCredentialStore = defineStore('supplier-credential', () => {
  const repositories = useNuxtApp().$repositories
  return {
    createSession: (target: () => SupplierCredentialTarget) => createSupplierCredentialState(repositories.supplierCredentials, target, undefined, repositories.supplierProduction),
  }
})
