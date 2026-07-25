import type { WorkerFormDraft } from '~/lib/master-data/forms'
import { defineStore } from 'pinia'
import {
  loadWorkerForm,
  saveWorkerForm,
} from '~/lib/master-data/forms'
import { createMasterDataFormState } from './master-data-form'

export const useWorkerStore = defineStore('worker', () => createMasterDataFormState<WorkerFormDraft>(
  'worker',
  loadWorkerForm,
  saveWorkerForm,
))
