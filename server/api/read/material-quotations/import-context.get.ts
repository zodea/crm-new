import { materialQuotationImportContextRead, throwQuotationHttpError } from '../../../utils/material-quotation-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await materialQuotationImportContextRead(event)
  }
  catch (cause) {
    return throwQuotationHttpError(cause)
  }
})
