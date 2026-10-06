import type { QuotationRead } from '~/lib/material-quotation/contract'
import { quotationUnknownProblem } from '~/lib/material-quotation/http-repository'
import { bindReadAuthority } from '~/lib/read-model/authority'

export const useMaterialQuotationStore = defineStore('material-quotation', () => {
  const repository = useMaterialQuotationRepository()
  const snapshot = shallowRef<QuotationRead | null>(null)
  const loading = shallowRef(false)
  const error = shallowRef('')
  let generation = 0
  function invalidate() {
    generation++
    snapshot.value = null
    loading.value = false
    error.value = ''
  }
  bindReadAuthority(invalidate)
  async function load() {
    const owner = ++generation
    snapshot.value = null
    loading.value = true
    error.value = ''
    try {
      const read = await repository.list()
      if (owner === generation)
        snapshot.value = read
    }
    catch (cause) {
      if (owner === generation)
        error.value = quotationUnknownProblem(cause).message
      throw cause
    }
    finally {
      if (owner === generation)
        loading.value = false
    }
  }
  return { snapshot, loading, error, load, invalidate }
})
