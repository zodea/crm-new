import { materialQuotationRuntime, throwQuotationHttpError } from '../../../utils/material-quotation-runtime'

export default defineEventHandler(async (event) => {
  try {
    const { owner, session } = materialQuotationRuntime(event)
    return await owner.importGraph(await readBody(event), session)
  }
  catch (cause) {
    return throwQuotationHttpError(cause)
  }
})
