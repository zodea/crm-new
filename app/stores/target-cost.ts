import { defineStore } from 'pinia'
import {
  loadTargetCostForm,
  saveTargetCostForm,
} from '~/lib/master-data/forms'
import { createMasterDataFormState } from './master-data-form'

export const useTargetCostStore = defineStore('target-cost', () => createMasterDataFormState(
  'target_cost',
  loadTargetCostForm,
  saveTargetCostForm,
))
