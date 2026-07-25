import { defineStore } from 'pinia'
import {
  loadCustomerForm,
  saveCustomerForm,
} from '~/lib/master-data/forms'
import { createMasterDataFormState } from './master-data-form'

export const useCustomerStore = defineStore('customer', () => createMasterDataFormState(
  'customer',
  loadCustomerForm,
  saveCustomerForm,
))
