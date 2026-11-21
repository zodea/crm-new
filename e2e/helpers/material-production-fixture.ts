import type { Page } from '@playwright/test'
import type { DeliveryDraftLine } from '../../app/lib/delivery-record/contract'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import { updateProductionSnapshot } from './browser-production-snapshot'
import { createVerifiedSignatory, verifiedSignatoryAdoption } from './contract-signatory'

export const MATERIAL_PRODUCTION_FIXTURE = {
  projectName: 'E2E正式物资项目',
  projectSiteAlias: 'E2E正式物资项目部',
  supplierName: 'E2E正式大板东建材有限公司',
  contractName: 'E2E正式瓷砖采购合同',
  deliveryOrderNo: 'E2E-OCR-ARCHIVE-001',
  deliverySourceName: 'e2e-ocr-source.png',
} as const

const SOURCE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII='

/** 正式身份来自中央命令回执；未迁入的物资模块仅镜像其现有本地读取边界。 */
export async function installMaterialProductionFixture(page: Page, options: { legacyMaterial?: boolean, deliveryLines?: DeliveryDraftLine[] } = {}) {
  await page.context().setExtraHTTPHeaders({ 'x-ruihang-test-session': `material-fixture-${randomUUID()}` })
  await page.addInitScript(() => localStorage.setItem('ruihang:workspace-default:include-demo', 'false'))
  const session = await (await page.request.get('/api/read/business-session')).json()
  const identity = { workspaceId: session.workspaceId, actorId: session.actorId }
  const create = async (domain: string, requiredCapability: string, draft: Record<string, unknown>, action = 'draft') => {
    const response = await page.request.post(`/api/commands/${domain}`, { data: { ...identity, requiredCapability, commandId: randomUUID(), baseVersion: null, action, draft, attachments: {} } })
    expect(response.ok(), await response.text()).toBe(true)
    return response.json()
  }
  const project = await create('projects', 'project:write', { name: MATERIAL_PRODUCTION_FIXTURE.projectName, manager: '合成经办人', status: '筹备中' })
  const supplier = await create('suppliers', 'supplier:write', { name: MATERIAL_PRODUCTION_FIXTURE.supplierName, supplierCategory: '材料供应商', aliases: [] })
  const signatoryId = await createVerifiedSignatory(page, 'E2E物资已核实我方主体')
  const adoption = await verifiedSignatoryAdoption(page, signatoryId)
  const contract = await create('material-contracts', 'material-contract:write', { ...adoption, name: MATERIAL_PRODUCTION_FIXTURE.contractName, content: '正式瓷砖采购验收', projectId: project.id, supplierId: supplier.id, amount: 100000, taxRate: null, signDate: '2026-08-01', lineItems: [{ materialName: 'E2E正式瓷砖', unit: '㎡', qty: 10000, taxInclusiveUnitPrice: 10 }] }, 'submit')
  const archived = await page.request.post('/api/commands/deliveries', { data: {
    ...identity,
    requiredCapability: 'delivery:write',
    commandId: randomUUID(),
    origin: 'real',
    baseVersion: null,
    action: 'archive',
    uploadBatchId: null,
    source: { fileName: MATERIAL_PRODUCTION_FIXTURE.deliverySourceName, mimeType: 'image/png', fileSize: Buffer.from(SOURCE_PNG_BASE64, 'base64').length, payloadBase64: SOURCE_PNG_BASE64 },
    draft: { projectId: project.id, supplierId: supplier.id, orderNo: MATERIAL_PRODUCTION_FIXTURE.deliveryOrderNo, deliveryDate: '2026-08-01', note: '合成 OCR 归档来源', rawSiteText: MATERIAL_PRODUCTION_FIXTURE.projectSiteAlias, reviewFlag: '', confirmations: {}, lines: options.deliveryLines ?? [{ materialName: 'E2E正式瓷砖', spec: '600×600', unit: '㎡', qty: 3, unitPrice: 10, amount: 30, amountSource: 'ocr', note: '' }] },
  } })
  expect(archived.ok(), await archived.text()).toBe(true)
  const delivery = await archived.json()
  const excluded = await page.request.post('/api/commands/deliveries', { data: { ...identity, requiredCapability: 'delivery:write', commandId: randomUUID(), origin: 'real', action: 'print', targets: [{ id: delivery.id, baseVersion: delivery.version }], disposition: 'excluded' } })
  expect(excluded.ok(), await excluded.text()).toBe(true)
  const fixture: typeof MATERIAL_PRODUCTION_FIXTURE & { projectId: string, supplierId: string, contractId: string, deliveryId: string } = { ...MATERIAL_PRODUCTION_FIXTURE, projectId: project.id, supplierId: supplier.id, contractId: contract.id, deliveryId: delivery.id }
  if (options.legacyMaterial) {
    await page.goto('/material/requisition')
    await expect(page.getByLabel('单据列表工具栏')).toBeVisible({ timeout: 30_000 })
    await updateProductionSnapshot(page, (database) => {
      database.run('INSERT INTO projects (id, name, code, status, source) VALUES (?, ?, \'E2E-MATERIAL-PROD\', \'筹备中\', \'e2e-production-fixture\')', [fixture.projectId, fixture.projectName])
      database.run('INSERT INTO suppliers (id, name, aliases, supplier_category, approval_status, source) VALUES (?, ?, \'[]\', \'材料供应商\', \'approved\', \'e2e-production-fixture\')', [fixture.supplierId, fixture.supplierName])
      database.run('INSERT INTO project_aliases (id, project_id, alias) VALUES (?, ?, ?)', [randomUUID(), fixture.projectId, fixture.projectSiteAlias])
      database.run('INSERT INTO project_suppliers (id, project_id, supplier_id, status) VALUES (?, ?, ?, \'active\')', [randomUUID(), fixture.projectId, fixture.supplierId])
      database.run('INSERT INTO contracts (id, no, name, kind, project_id, supplier_id, amount, sign_date, status) VALUES (?, \'E2E-MATERIAL-CONTRACT-001\', ?, \'材采\', ?, ?, 100000, \'2026-08-01\', \'履约中\')', [fixture.contractId, fixture.contractName, fixture.projectId, fixture.supplierId])
    })
  }
  return fixture
}
