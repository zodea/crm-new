import { createError, defineEventHandler, getQuery, setResponseHeader } from 'h3'
import { assertProductionRequest, requireProductionBusinessSession } from '../utils/production-auth'
import { isProductionAuxiliaryContractRoute } from '../utils/production-auxiliary-contract-schema'
import { isProductionBoqRoute } from '../utils/production-boq-access'
import { getProductionRuntimeConfig } from '../utils/production-config'
import { isProductionConstructionContractRoute } from '../utils/production-construction-contract-access'
import { isProductionConstructionScopeRoute } from '../utils/production-construction-scope-access'
import { isProductionCrewWorkerRoute } from '../utils/production-crew-worker-access'
import { isProductionFinanceRoute } from '../utils/production-finance-access'
import { isProductionMaterialContractRoute } from '../utils/production-material-contract-access'
import { isProductionMaterialQuotationRoute } from '../utils/production-material-quotation-access'
import { isProductionOtherSettlementRoute } from '../utils/production-other-settlement-access'
import { isProductionOwnerDocumentRoute } from '../utils/production-owner-document-schema'
import { isProductionPayrollRoute } from '../utils/production-payroll-access'
import { isProductionProcessLibraryRequest } from '../utils/production-process-library-access'
import { isProductionProjectRoute } from '../utils/production-project-access'
import { isProductionQuantityRoute } from '../utils/production-quantity-access'
import { isProductionSubcontractContractRoute } from '../utils/production-subcontract-contract-access'
import { isProductionSupplierRoute } from '../utils/production-supplier-access'
import { isProductionTargetCostRoute } from '../utils/production-target-cost-access'
import { isProductionWbsRoute } from '../utils/production-wbs-access'

const id = String.raw`[A-Za-z0-9][\w-]{2,79}`
const readyReads = new RegExp(`^/api/read/(?:business-session|customers|customers-deleted|customer-commands/${id}|customers/${id}(?:/(?:form|lifecycle|audit|files/${id}))?)$`)
const readyWrites = new RegExp(`^/api/commands/customers/${id}(?:/lifecycle)?$`)

export default defineEventHandler((event) => {
  const config = getProductionRuntimeConfig()
  if (!config)
    return
  assertProductionRequest(event, config)
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff')
  const path = event.path.split('?')[0]!
  if (!path.startsWith('/api/'))
    return
  if ((event.method === 'GET' && path === '/api/auth/status') || (event.method === 'POST' && ['/api/auth/login', '/api/auth/logout'].includes(path)))
    return
  requireProductionBusinessSession(event, { touch: event.method !== 'GET' || !['/api/production/backup/status', '/api/read/notifications'].includes(path) })
  const query = getQuery(event)
  if ((query.includeDemo !== undefined && query.includeDemo !== 'false') || Object.values(query).some(value => ['demo', 'all'].includes(String(value)) || (Array.isArray(value) && value.some(item => ['demo', 'all'].includes(String(item))))))
    throw createError({ statusCode: 403, message: '正式入口不提供演示数据源。' })
  const ready = (event.method === 'GET' && (readyReads.test(path) || ['/api/production/status', '/api/production/backup/status', '/api/read/notifications'].includes(path)))
    || isProductionProjectRoute(event.method, path)
    || isProductionFinanceRoute(event.method, path)
    || isProductionCrewWorkerRoute(event.method, path)
    || isProductionOtherSettlementRoute(event.method, path)
    || isProductionOwnerDocumentRoute(event.method, path)
    || isProductionTargetCostRoute(event.method, path)
    || isProductionPayrollRoute(event.method, path)
    || isProductionQuantityRoute(event.method, path)
    || isProductionWbsRoute(path, event.method)
    || isProductionConstructionContractRoute(path, event.method)
    || isProductionSubcontractContractRoute(path, event.method)
    || isProductionAuxiliaryContractRoute(path, event.method)
    || isProductionBoqRoute(event.method, path)
    || isProductionConstructionScopeRoute(event.method, path)
    || isProductionProcessLibraryRequest(event.method, path)
    || (event.method === 'POST' && (['/api/commands/customers', '/api/commands/customer-resolve', '/api/commands/production-backups', '/api/commands/notifications'].includes(path) || (readyWrites.test(path) && path.endsWith('/lifecycle'))))
    || (event.method === 'PUT' && readyWrites.test(path) && !path.endsWith('/lifecycle'))
  const signatories = (event.method === 'GET' && path === '/api/read/our-signatories')
    || (event.method === 'POST' && ['/api/commands/our-signatories', '/api/commands/our-signatories/resolve'].includes(path))
  if (!ready && !signatories && !isProductionSupplierRoute(event.method, path) && !isProductionMaterialContractRoute(event.method, path) && !isProductionMaterialQuotationRoute(event.method, path))
    throw createError({ statusCode: 503, message: '此功能的正式保存尚未就绪，请返回已开放的资料页面；不会使用测试实例替代。' })
})
