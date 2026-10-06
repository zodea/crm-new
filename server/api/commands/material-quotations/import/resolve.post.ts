import { parseResolveCommandBody } from '../../../../utils/command-journal'
import { materialQuotationRuntime, throwQuotationHttpError } from '../../../../utils/material-quotation-runtime'

export default defineEventHandler(async (event) => {
  try {
    const { owner, session } = materialQuotationRuntime(event)
    return await owner.resolveImport(parseResolveCommandBody(await readBody(event)), session)
  }
  catch (cause) {
    return throwQuotationHttpError(cause)
  }
})
