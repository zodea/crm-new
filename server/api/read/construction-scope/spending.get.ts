import { financeFailure } from '../../../../app/lib/finance/central-contract'
import { productionConstructionScopeRuntime } from '../../../utils/production-construction-scope-runtime'
import { readProductionConstructionSpending } from '../../../utils/production-construction-scope-spending'
import { throwQuantityError } from '../../../utils/quantity-error'

export default defineEventHandler(async (event) => {
  try {
    const query = getQuery(event)
    if (Object.keys(query).some(key => !['projectId', 'mainId'].includes(key)) || typeof query.projectId !== 'string' || !query.projectId || (query.mainId !== undefined && (typeof query.mainId !== 'string' || !query.mainId)))
      return financeFailure('validation-failed', '施工开支读取范围无效。')
    const runtime = productionConstructionScopeRuntime(event)
    const actor = runtime.session()
    const value = await runtime.storage.withTransaction(tx => readProductionConstructionSpending(tx, actor, String(query.projectId), typeof query.mainId === 'string' ? query.mainId : null))
    if (JSON.stringify(actor) !== JSON.stringify(runtime.session()))
      return financeFailure('forbidden', '施工开支读取期间身份或权限变化。')
    return value
  }
  catch (cause) { throwQuantityError(cause) }
})
