import { createError, defineEventHandler, readBody } from 'h3'
import { productionMaterialContractRuntime } from '../../../utils/production-material-contract-runtime'
import { productionSession, throwProductionStorageError } from '../../../utils/production-runtime'
import { throwProjectReadError } from '../../../utils/project-read-error'

export default defineEventHandler(async (event) => {
  try {
    const production = productionMaterialContractRuntime()
    if (!production)
      throw createError({ statusCode: 503, message: '采购合同导入需要已认证的正式中央工作区。' })
    return await production.contracts.previewExcel(await readBody(event), productionSession(event))
  }
  catch (cause) {
    throwProductionStorageError(cause)
    throwProjectReadError(cause)
  }
})
