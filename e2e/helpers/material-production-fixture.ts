import type { Page } from '@playwright/test'
import { updateProductionSnapshot } from './browser-production-snapshot'

export const MATERIAL_PRODUCTION_FIXTURE = {
  projectId: 'project-e2e-material-production',
  projectName: 'E2E正式物资项目',
  projectSiteAlias: 'E2E正式物资项目部',
  supplierId: 'supplier-e2e-material-production',
  supplierName: 'E2E正式大板东建材有限公司',
  contractId: 'contract-e2e-material-production',
  contractName: 'E2E正式瓷砖采购合同',
  deliveryId: 'delivery-e2e-ocr-archive',
  deliveryOrderNo: 'E2E-OCR-ARCHIVE-001',
  deliverySourceName: 'e2e-ocr-source.png',
} as const

const SOURCE_PNG_BASE64
  = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

/**
 * 在浏览器 production 快照中安装最小正式主数据。后续仍经路由、
 * Repository 和页面操作验证行为；不开启、复制或写入只读 demo 工作区。
 */
export async function installMaterialProductionFixture(page: Page): Promise<void> {
  await page.goto('/material/delivery/archive')
  await page.getByRole('link', { name: '新增送货单', exact: true })
    .waitFor({ state: 'visible', timeout: 60_000 })

  await updateProductionSnapshot(page, (database) => {
    database.run(`
      INSERT INTO projects (id, name, code, status, source)
      VALUES (?, ?, 'E2E-MATERIAL-PROD', '施工中', 'e2e-production-fixture')
    `, [
      MATERIAL_PRODUCTION_FIXTURE.projectId,
      MATERIAL_PRODUCTION_FIXTURE.projectName,
    ])
    database.run(`
      INSERT INTO suppliers (
        id, name, aliases, supplier_category, approval_status, source
      ) VALUES (?, ?, '[]', '材料供应商', 'approved', 'e2e-production-fixture')
    `, [
      MATERIAL_PRODUCTION_FIXTURE.supplierId,
      MATERIAL_PRODUCTION_FIXTURE.supplierName,
    ])
    database.run(`
      INSERT INTO project_aliases (id, project_id, alias)
      VALUES ('project-alias-e2e-material-production', ?, ?)
    `, [
      MATERIAL_PRODUCTION_FIXTURE.projectId,
      MATERIAL_PRODUCTION_FIXTURE.projectSiteAlias,
    ])
    database.run(`
      INSERT INTO project_suppliers (id, project_id, supplier_id, status)
      VALUES ('project-supplier-e2e-material-production', ?, ?, 'active')
    `, [
      MATERIAL_PRODUCTION_FIXTURE.projectId,
      MATERIAL_PRODUCTION_FIXTURE.supplierId,
    ])
    database.run(`
      INSERT INTO contracts (
        id, no, name, kind, project_id, supplier_id, amount, sign_date, status
      ) VALUES (?, 'E2E-MATERIAL-CONTRACT-001', ?, '材采', ?, ?, 100000, '2026-08-01', '履约中')
    `, [
      MATERIAL_PRODUCTION_FIXTURE.contractId,
      MATERIAL_PRODUCTION_FIXTURE.contractName,
      MATERIAL_PRODUCTION_FIXTURE.projectId,
      MATERIAL_PRODUCTION_FIXTURE.supplierId,
    ])
    database.run(`
      INSERT INTO delivery_records (
        id, project_id, supplier_id, raw_site_text, order_no, delivery_date,
        file_name, ocr_status, archived, stored, print_batch_id,
        print_disposition, note
      ) VALUES (
        ?, ?, ?, ?, ?, '2026-08-01', ?, 'reviewed', 1, 1,
        'delivery-print-batch-e2e-ocr-archive', 'excluded',
        'E2E 正式快照 OCR 验收原件'
      )
    `, [
      MATERIAL_PRODUCTION_FIXTURE.deliveryId,
      MATERIAL_PRODUCTION_FIXTURE.projectId,
      MATERIAL_PRODUCTION_FIXTURE.supplierId,
      MATERIAL_PRODUCTION_FIXTURE.projectSiteAlias,
      MATERIAL_PRODUCTION_FIXTURE.deliveryOrderNo,
      MATERIAL_PRODUCTION_FIXTURE.deliverySourceName,
    ])
    database.run(`
      INSERT INTO delivery_lines (
        id, delivery_record_id, material_name, spec, unit, qty,
        unit_price, amount, amount_source, sort_order
      ) VALUES (
        'delivery-line-e2e-ocr-archive', ?, 'E2E 正式瓷砖',
        '600×600', '㎡', 3, 10, 30, 'ocr', 0
      )
    `, [
      MATERIAL_PRODUCTION_FIXTURE.deliveryId,
    ])
    database.run(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, file_size, category, mime_type
      ) VALUES (
        'file-e2e-ocr-archive', 'delivery_record', ?, ?, 68, 'source', 'image/png'
      )
    `, [
      MATERIAL_PRODUCTION_FIXTURE.deliveryId,
      MATERIAL_PRODUCTION_FIXTURE.deliverySourceName,
    ])
    database.run(`
      INSERT INTO file_payloads (file_ref_id, encoding, content)
      VALUES ('file-e2e-ocr-archive', 'base64', ?)
    `, [
      SOURCE_PNG_BASE64,
    ])
  })
}
