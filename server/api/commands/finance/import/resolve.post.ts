import { financeApi, throwFinanceError } from '../../../../utils/finance-api'

export default defineEventHandler(async (event) => {
  try {
    const source = financeApi(event)
    return await source.finance.resolveImport(await readBody(event), source.session)
  }
  catch (cause) { throwFinanceError(cause) }
})
