import { materialQuotationRuntime, throwQuotationHttpError } from '../../../utils/material-quotation-runtime'
import { createReadMeta, readSourceVersion, withReadMeta } from '../../../utils/read-meta'

export default defineEventHandler(async (event) => {
  try {
    if (Object.keys(getQuery(event)).length)
      throw createError({ statusCode: 422, statusMessage: 'Unsupported import query' })
    const { owner, session } = materialQuotationRuntime(event)
    const records = await owner.imports(session)
    const asOf = new Date().toISOString()
    const meta = createReadMeta({ session: session(), schemaVersion: 'material-quotation-import-read-v1', operation: 'material-quotation:imports', dataOrigin: 'real', asOf, coverage: 'complete', scope: {}, sources: [{ key: 'quotation-imports', state: 'readable', sourceVersion: readSourceVersion('quotation-imports', records), asOf }] })
    return withReadMeta({ records }, meta)
  }
  catch (cause) {
    return throwQuotationHttpError(cause)
  }
})
