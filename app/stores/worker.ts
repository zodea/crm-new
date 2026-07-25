import { defineStore } from 'pinia'
import {
  loadWorkerForm,
  saveWorkerForm,
} from '~/lib/master-data/forms'
import { createMasterDataFormState } from './master-data-form'

export const useWorkerStore = defineStore('worker', () => createMasterDataFormState(
  'worker',
  loadWorkerForm,
  saveWorkerForm,
))
