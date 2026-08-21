import type { Page } from '@playwright/test'
import { updateProductionSnapshot } from './browser-production-snapshot'

export const QUANTITY_PRODUCTION_FIXTURE = {
  projectId: 'project-e2e-quantity-production',
  projectName: 'E2E正式工程量项目',
} as const

/**
 * 在隔离浏览器的 production 快照安装可写工程量事实。测试仍从真实页面、
 * Pinia store 与 SQLite 写链完成责任替换；不打开或复制只读 demo 工作区。
 */
export async function installQuantityProductionFixture(page: Page): Promise<void> {
  await page.goto('/subcontract/quantity')
  await page.getByText('尚无可用项目', { exact: true })
    .waitFor({ state: 'visible', timeout: 60_000 })

  await updateProductionSnapshot(page, (database) => {
    database.run(`
      INSERT INTO projects (id, name, code, status, source)
      VALUES (
        'project-e2e-quantity-production',
        'E2E正式工程量项目',
        'E2E-QUANTITY-PROD',
        '施工中',
        'e2e-production-fixture'
      );

      INSERT INTO buildings (id, project_id, code, name, sort_order)
      VALUES ('qty-e2e-building', 'project-e2e-quantity-production', 'B1', '1栋', 0);

      INSERT INTO floors (id, building_id, code, name, sort_order) VALUES
        ('qty-e2e-floor-2', 'qty-e2e-building', 'F2', '2层', 0),
        ('qty-e2e-floor-1', 'qty-e2e-building', 'F1', '1层', 1);

      INSERT INTO house_type_templates (id, project_id, code, name, sort_order)
      VALUES ('qty-e2e-template', 'project-e2e-quantity-production', 'A', 'A户型', 0);

      INSERT INTO units (id, floor_id, house_type_template_id, code, name, sort_order) VALUES
        ('qty-e2e-unit-201', 'qty-e2e-floor-2', 'qty-e2e-template', '201', '201户', 0),
        ('qty-e2e-unit-202', 'qty-e2e-floor-2', 'qty-e2e-template', '202', '202户', 1),
        ('qty-e2e-unit-101', 'qty-e2e-floor-1', 'qty-e2e-template', '101', '101户', 0),
        ('qty-e2e-unit-102', 'qty-e2e-floor-1', 'qty-e2e-template', '102', '102户', 1);

      INSERT INTO items (id, project_id, code, name, section, trade, unit, sort_order) VALUES
        ('qty-e2e-item-masonry', 'project-e2e-quantity-production', 'MASONRY', '墙砖铺贴', '装饰', '泥水工', '㎡', 0),
        ('qty-e2e-item-plumbing', 'project-e2e-quantity-production', 'PLUMBING', '给排水管安装', '安装', '水暖工', 'm', 1);

      INSERT INTO house_type_template_items (
        id, room_id, item_id, contract_qty, provisional_qty, field_qty, sort_order
      ) VALUES
        ('qty-e2e-line-masonry', 'qty-e2e-template:whole_unit', 'qty-e2e-item-masonry', 12, 12, 12, 0),
        ('qty-e2e-line-plumbing', 'qty-e2e-template:whole_unit', 'qty-e2e-item-plumbing', 8, 8, 8, 1);

      INSERT INTO construction_stages (
        id, project_id, code, name, trade, completion_mode, sort_order
      ) VALUES
        ('qty-e2e-stage-masonry', 'project-e2e-quantity-production', 'MASONRY-DONE', '泥水完成', '泥水工', 'unit', 0),
        ('qty-e2e-stage-plumbing', 'project-e2e-quantity-production', 'PLUMBING-DONE', '水暖完成', '水暖工', 'unit', 1);

      INSERT INTO construction_stage_items (id, stage_id, item_id) VALUES
        ('qty-e2e-stage-item-masonry', 'qty-e2e-stage-masonry', 'qty-e2e-item-masonry'),
        ('qty-e2e-stage-item-plumbing', 'qty-e2e-stage-plumbing', 'qty-e2e-item-plumbing');

      INSERT INTO crews (
        id, name, trade, trade_capabilities, item_capabilities
      ) VALUES
        ('qty-e2e-crew-a', '泥水A班', '泥水工', '["泥水工"]', '[]'),
        ('qty-e2e-crew-b', '泥水B班', '泥水工', '["泥水工"]', '[]'),
        ('qty-e2e-crew-water', '水电班', '水暖工', '["水暖工"]', '[]');

      INSERT INTO workers (
        id, crew_id, name, trade, trade_capabilities, item_capabilities
      ) VALUES (
        'qty-e2e-worker-zhou',
        'qty-e2e-crew-water',
        '周伟峰',
        '水暖工',
        '["水暖工"]',
        '["给排水管安装"]'
      );

      INSERT INTO unit_assignments (id, unit_id, trade, crew_id, note) VALUES
        ('qty-e2e-asg-201-masonry', 'qty-e2e-unit-201', '泥水工', 'qty-e2e-crew-a', '低区泥水A班'),
        ('qty-e2e-asg-202-masonry', 'qty-e2e-unit-202', '泥水工', 'qty-e2e-crew-b', '低区泥水B班'),
        ('qty-e2e-asg-101-masonry', 'qty-e2e-unit-101', '泥水工', 'qty-e2e-crew-a', NULL),
        ('qty-e2e-asg-102-masonry', 'qty-e2e-unit-102', '泥水工', 'qty-e2e-crew-b', NULL);

      INSERT INTO unit_stage_completions (
        id, unit_id, stage_id, assignment_id, status, completed_at, note
      ) VALUES (
        'qty-e2e-completion-201-masonry',
        'qty-e2e-unit-201',
        'qty-e2e-stage-masonry',
        'qty-e2e-asg-201-masonry',
        'completed',
        '2026-08-01',
        '保存责任替换后仍保留完成时责任'
      );
    `)
  })
}
