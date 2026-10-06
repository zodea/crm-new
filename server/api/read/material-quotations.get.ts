import { materialQuotationRead, throwQuotationHttpError } from '../../utils/material-quotation-runtime'

export default defineEventHandler(async (event) => {
  try {
    if (Object.keys(getQuery(event)).length)
      throw createError({ statusCode: 422, statusMessage: 'Unsupported quotation query' })
    return await materialQuotationRead(event)
  }
  catch (cause) { return throwQuotationHttpError(cause) }
})
