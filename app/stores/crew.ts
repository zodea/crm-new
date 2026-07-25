import { defineStore } from 'pinia'
import {
  loadCrewForm,
  saveCrewForm,
} from '~/lib/master-data/forms'
import { createMasterDataFormState } from './master-data-form'

export const useCrewStore = defineStore('crew', () => createMasterDataFormState(
  'crew',
  loadCrewForm,
  saveCrewForm,
))
