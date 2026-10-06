import { materialQuotationRuntime, throwQuotationHttpError } from '../../../../../utils/material-quotation-runtime'

export default defineEventHandler(async (event) => {
  try {
    const { owner, session } = materialQuotationRuntime(event)
    const query = getQuery(event)
    if (Object.keys(query).some(key => key !== 'version') || (query.version !== undefined && (typeof query.version !== 'string' || !/^[1-9]\d*$/.test(query.version))))
      throw createError({ statusCode: 422, statusMessage: 'Invalid original version' })
    return await owner.original(getRouterParam(event, 'id') ?? '', getRouterParam(event, 'fileId') ?? '', session, query.version as string | undefined)
  }
  catch (cause) {
    return throwQuotationHttpError(cause)
  }
})
