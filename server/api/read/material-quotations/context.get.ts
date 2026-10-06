import { materialQuotationContextRead, throwQuotationHttpError } from '../../../utils/material-quotation-runtime'

export default defineEventHandler(async (event) => {
  try {
    return await materialQuotationContextRead(event)
  }
  catch (cause) {
    return throwQuotationHttpError(cause)
  }
})
