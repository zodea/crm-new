export type NumericDraft = number | '' | null

export interface FactorDraft {
  id: number
  value: NumericDraft
  maxQuantity: NumericDraft
  allowDecimal: boolean
}

export interface FactorSolverStoredState {
  target: NumericDraft
  maxResults: NumericDraft
  factors: FactorDraft[]
}
