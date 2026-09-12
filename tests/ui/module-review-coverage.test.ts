import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildModuleReviewCoverage, MODULE_REVIEW_COVERAGE_PATH, MODULE_REVIEW_INDEX_PATH, renderModuleReviewIndex } from '../../scripts/module-review-coverage.mjs'
import { REVIEW_OBLIGATIONS, validateReviewObligations } from '../../scripts/module-review-obligations.mjs'
import { buildRuntimeEvidenceLedger } from '../../scripts/runtime-evidence-ledger.mjs'

describe('module review coverage', () => {
  it('registers stage creation, editing and reporting as unverified central browser work', () => {
    const { surfaces, cases } = buildModuleReviewCoverage()
    const stages = surfaces.filter(surface => surface.route === '/subcontract/quantity/stages')
    expect(stages.filter(surface => surface.path === 'page').map(surface => surface.mode)).toEqual(['new', 'edit'])
    expect(stages.some(surface => surface.path === 'section/QuantityStageReporting')).toBe(true)
    expect(stages.every(surface => surface.hosts.length === 1 && surface.hosts[0] === 'browser')).toBe(true)
    const stageCases = cases.filter(item => stages.some(surface => surface.id === item.surfaceId))
    expect(stageCases.length).toBeGreaterThan(0)
    expect(stageCases.every(item => item.adapter === 'central-http' && item.acceptance.frontend !== 'passed' && item.acceptance.production !== 'passed')).toBe(true)
  })

  it('covers every production route without treating route evidence as subview acceptance', () => {
    const coverage = buildModuleReviewCoverage()
    expect(new Set(coverage.surfaces.map(surface => surface.route))).toEqual(
      new Set(buildRuntimeEvidenceLedger().endpoints.map(endpoint => endpoint.localRoute)),
    )
    expect(new Set(coverage.cases.map(item => item.id)).size).toBe(coverage.cases.length)
    expect(coverage.cases.every(item => item.acceptance.production !== 'passed')).toBe(true)
    expect(coverage.cases.filter(item => item.reference.status === 'not-observed').length).toBeGreaterThan(137)
    expect(coverage.excludedDevPages).toHaveLength(5)
  })

  it('records central quantity pages and imports while preserving desktop and downstream boundaries', () => {
    const { surfaces, cases, adapterProfiles } = buildModuleReviewCoverage()
    const quantityRoutes = ['/subcontract/quantity', '/subcontract/quantity/:pid/:uid', '/subcontract/quantity/region', '/subcontract/quantity/template']
    const imports = ['quantity-template', 'quantity-assignment', 'quantity-completion']
    const selected = surfaces.filter(surface => quantityRoutes.includes(surface.route)
      || (surface.route === '/import/mapping/:entity' && imports.includes(surface.kind)))
    expect(new Set(selected.map(surface => surface.route))).toEqual(new Set([...quantityRoutes, '/import/mapping/:entity']))
    for (const surface of selected) {
      const browser = cases.find(item => item.surfaceId === surface.id && item.host === 'browser')!
      expect(browser.adapter).toBe('central-http')
      expect(browser.acceptance.production).toBe('not-verified')
      const desktop = cases.find(item => item.surfaceId === surface.id && item.host === 'tauri')
      if (desktop)
        expect(desktop.adapter).toBe(surface.variant === 'central-source' ? 'central-http' : 'desktop-sqlite')
    }
    for (const route of ['/subcontract/payroll', '/schedule', '/project/target-cost']) {
      const surface = surfaces.find(item => item.route === route && item.path === 'page')!
      expect(cases.find(item => item.surfaceId === surface.id && item.host === 'browser')?.adapter).toBe('browser-local')
    }
    expect(adapterProfiles['central-http'].storage).toContain('不具备进程重启持久化证据')
  })

  it('expands registered document kinds and warranty only on the mounted views', () => {
    const { surfaces } = buildModuleReviewCoverage()
    const roots = surfaces.filter(surface => surface.path === 'page')
    expect(roots.filter(surface => surface.route === '/owner/:kind/new').map(surface => surface.kind).sort()).toEqual([
      'acceptance',
      'final_settlement',
      'owner_change',
      'owner_penalty',
      'owner_report',
    ])
    expect(roots.filter(surface => surface.route === '/subcontract/:kind').map(surface => surface.kind).sort()).toEqual(['sub_change', 'sub_settlement'])
    expect(roots.filter(surface => surface.variant === 'warranty').map(surface => surface.route).sort()).toEqual(['/owner/:kind', '/owner/:kind/:id'])
    expect(surfaces.some(surface => surface.kind.includes(':kind'))).toBe(false)
  })

  it('separates new/edit modes and the central versus legacy contract detail', () => {
    const { surfaces, cases } = buildModuleReviewCoverage()
    expect(surfaces.filter(surface => surface.route === '/project/form/:id?' && surface.path === 'page').map(surface => surface.mode).sort()).toEqual(['edit', 'new'])
    const contract = surfaces.filter(surface => surface.route === '/contract/:id' && surface.path === 'page')
    expect(contract.filter(surface => surface.variant === 'central').map(surface => surface.kind).sort()).toEqual(['construction', 'material', 'subcontract'])
    for (const surface of contract.filter(surface => surface.variant === 'central')) {
      expect(cases.filter(item => item.surfaceId === surface.id).map(item => item.host)).toEqual(['browser'])
      expect(surface.condition).toContain('origin')
    }
    expect(contract.filter(surface => surface.variant === 'legacy').map(surface => surface.kind).sort()).toEqual(['分包', '施工', '材采'])
  })

  it('tracks every import entity through mapping and preview, with real write boundaries', () => {
    const { surfaces, cases } = buildModuleReviewCoverage()
    const imports = surfaces.filter(surface => surface.route === '/import/mapping/:entity')
    expect(new Set(imports.map(surface => surface.kind)).size).toBe(8)
    for (const kind of new Set(imports.map(surface => surface.kind)))
      expect(imports.filter(surface => surface.kind === kind).map(surface => surface.path)).toEqual(expect.arrayContaining(['page', 'step/upload', 'step/mapping', 'step/preview-import']))
    const at = (kind: string) => cases.find(item => item.host === 'browser' && surfaces.some(surface => surface.id === item.surfaceId && surface.kind === kind && surface.path === 'page' && surface.route === '/import/mapping/:entity'))!
    expect(at('supplier').adapter).toBe('central-http')
    expect(at('project').adapter).toBe('central-http')
    expect(at('project').acceptance.frontend).toBe('passed')
    expect(at('project').acceptance.production).toBe('not-verified')
    expect(at('project').reviewEvidence).toContain('docs/design/evidence/issue-423/project-import-verification.md')
    expect(at('demo-supplier').adapter).toBe('simulation')
    expect(at('quantity-legacy-precheck').adapter).toBe('precheck-only')
  })

  it('does not infer desktop SQLite from the presence of a desktop host', () => {
    const { surfaces, cases } = buildModuleReviewCoverage()
    const at = (route: string, host: string, mode = 'view') => cases.find(item => item.host === host && surfaces.some(surface => surface.id === item.surfaceId && surface.route === route && surface.mode === mode && surface.path === 'page'))!
    expect(at('/project', 'tauri').adapter).toBe('central-http')
    expect(at('/project/form/:id?', 'tauri', 'new').adapter).toBe('desktop-sqlite')
    expect(at('/material/price', 'browser').adapter).toBe('browser-local')
    expect(at('/finance/invoice/factor', 'browser').adapter).toBe('tool-local-storage')
    expect(at('/finance/invoice/factor', 'tauri').adapter).toBe('tool-local-storage')
    expect(at('/settings/data-migration', 'tauri').adapter).toBe('unsupported')
    const penaltySources = surfaces.filter(item => item.route === '/project/penalty/:id' && item.variant === 'central-source' && item.path === 'page')
    expect(penaltySources.map(item => item.branchIdentity).sort()).toEqual(['crew', 'worker'])
    expect(penaltySources.every(item => cases.filter(row => row.surfaceId === item.id).every(row => row.adapter === 'central-http'))).toBe(true)
  })

  it('keeps the dedicated subcontract detail sections apart from desktop forms', () => {
    const { surfaces } = buildModuleReviewCoverage()
    const details = surfaces.filter(item => item.route === '/subcontract/:kind/:id')
    expect(details.filter(item => item.kind === 'sub_change' && item.hosts.length === 1 && item.hosts[0] === 'browser').map(item => item.path)).toEqual(['section/basic', 'files'])
    expect(details.filter(item => item.kind === 'sub_settlement' && item.hosts.length === 1 && item.hosts[0] === 'browser').map(item => item.path)).toEqual(['section/basic', 'section/payment', 'section/files'])
    expect(details.filter(item => item.path === 'desktop/form').every(item => item.hosts.length === 1 && item.hosts[0] === 'tauri')).toBe(true)
  })

  it('keeps menu-only evidence, unmapped abilities and scoped #422 acceptance explicit', () => {
    const coverage = buildModuleReviewCoverage()
    expect(coverage.referenceMenus.every(menu => menu.observation === 'menu-only')).toBe(true)
    expect(coverage.referenceMenus.find(menu => menu.label === '保证金申请')?.mappingStatus).toBe('pending')
    expect(coverage.referenceMenus.find(menu => menu.label === '保修到期确认单')?.localTargets).toContain('/owner/acceptance?variant=warranty')
    const surface = coverage.surfaces.find(item => item.route === '/contract/material' && item.path === 'page')!
    const localCase = coverage.cases.find(item => item.surfaceId === surface.id && item.host === 'browser')!
    expect(localCase.acceptance.frontend).toBe('partial')
    expect(localCase.reviewEvidence).toContain('docs/design/evidence/issue-422/README.md')
    expect(localCase.remaining).toContain('逐列筛选、排序、设置和文件工具仍由 #404/#409 复核')
  })

  it('preserves original reference observation dates when the source baseline is inspected later', () => {
    const coverage = buildModuleReviewCoverage()
    const originalMenus = coverage.referenceMenus.filter(menu => menu.evidence === 'docs/design/runtime-reference-audit.md#2026-09-08-复核基线与展开边界')
    expect(coverage.sourceInspectedAt > '2026-09-08').toBe(true)
    expect(originalMenus).toHaveLength(59)
    expect(new Set(originalMenus.map(menu => menu.date))).toEqual(new Set(['2026-09-08']))
  })

  it('keeps the committed inventory reproducible and every source anchor resolvable', () => {
    expect(JSON.parse(readFileSync(MODULE_REVIEW_COVERAGE_PATH, 'utf8'))).toEqual(buildModuleReviewCoverage())
    expect(readFileSync(MODULE_REVIEW_INDEX_PATH, 'utf8').replaceAll('\r\n', '\n')).toEqual(renderModuleReviewIndex(buildModuleReviewCoverage()))
  })

  it('links legacy obligations to actual host cases without inheriting page or production acceptance', () => {
    const coverage = buildModuleReviewCoverage()
    expect(coverage.obligations.length).toBeGreaterThan(20)
    expect(new Set(coverage.obligations.map(item => item.id)).size).toBe(coverage.obligations.length)
    for (const obligation of coverage.obligations) {
      expect(obligation.sources.length).toBeGreaterThan(0)
      expect(obligation.caseIds.length).toBeGreaterThan(0)
      for (const caseId of obligation.caseIds) {
        const linked = coverage.cases.find(item => item.id === caseId)!
        expect(linked.host).toBe('browser')
        expect(linked.obligationIds).toContain(obligation.id)
        expect(linked.acceptance.production).toBe('not-verified')
      }
      if (obligation.status === 'current-passed')
        expect(obligation.evidence.some(item => item.recency === 'current-run' && /^[a-f0-9]{40}$/.test(item.commit ?? ''))).toBe(true)
    }
    for (const caseItem of coverage.cases) {
      for (const id of caseItem.obligationIds ?? [])
        expect(coverage.obligations.some(item => item.id === id && item.caseIds.includes(caseItem.id))).toBe(true)
    }
  })

  it('retains unfulfilled OCR samples, central payments and global migration', () => {
    const coverage = buildModuleReviewCoverage()
    const at = (id: string) => coverage.obligations.find(item => item.id === id)!
    expect(at('OCR-06').status).toBe('partial')
    expect(at('PAY-05').status).toBe('ready')
    expect(at('MIG-07').status).toBe('partial')
    expect(at('PAY-08').status).toBe('needs-decision')
    const ocrCase = coverage.cases.find(item => item.obligationIds?.includes('OCR-04'))!
    expect(ocrCase.acceptance.frontend).not.toBe('passed')
  })

  it('records verified factor obligations at the implementation commit without upgrading the whole case', () => {
    const coverage = buildModuleReviewCoverage()
    const factors = coverage.obligations.filter(item => item.id.startsWith('FACTOR-'))
    expect(factors.map(item => item.id)).toEqual(['FACTOR-01', 'FACTOR-02', 'FACTOR-03', 'FACTOR-04'])
    for (const obligation of factors) {
      expect(obligation.status).toBe('current-passed')
      expect(obligation.ownerIssue).toBe(432)
      expect(obligation.sources).toContain('https://github.com/zodea/crm-new/issues/204#issuecomment-5145177434')
      expect(obligation.evidence).toContainEqual(expect.objectContaining({
        reference: 'docs/design/evidence/issue-432/factor-workbench-verification.md',
        commit: '338eaa978a7e325d6d7f86a9de272476ddfed5ef',
        recency: 'current-run',
      }))
      for (const caseId of obligation.caseIds) {
        const linked = coverage.cases.find(item => item.id === caseId)!
        expect(linked.acceptance.frontend).toBe('not-verified')
        expect(linked.acceptance.production).toBe('not-verified')
      }
    }
  })

  it('rejects duplicate obligations, stale case references and unsupported pass claims', () => {
    const { cases } = buildModuleReviewCoverage()
    const original = REVIEW_OBLIGATIONS[0]!
    expect(() => validateReviewObligations([original, original], cases)).toThrow('重复验收义务')
    expect(() => validateReviewObligations([{ ...original, caseIds: ['missing-case'] }], cases)).toThrow('缺少适用浏览器用例')
    expect(() => validateReviewObligations([{ ...original, evidence: [] }], cases)).toThrow('无固定提交的本轮证据')
    expect(() => validateReviewObligations([{ ...original, status: 'complete' }], cases)).toThrow('未知义务状态')
  })

  it('retains each inherited progress and payroll ticket without promoting local evidence to central acceptance', () => {
    const coverage = buildModuleReviewCoverage()
    const inherited = coverage.obligations.filter(item => item.id.startsWith('PRG-') || item.id.startsWith('WAGE-'))
    for (const number of [300, 301, 347, 348, 349, 350, 351, 352, 353, 354]) {
      expect(inherited.some(item => item.sources.includes(`https://github.com/zodea/crm-new/issues/${number}`))).toBe(true)
    }
    const byId = (id: string) => inherited.find(item => item.id === id)!
    expect(byId('WAGE-01').status).toBe('current-passed')
    expect(byId('WAGE-02').status).toBe('ready')
    expect(byId('WAGE-06').status).toBe('ready')
    expect(byId('WAGE-10').status).toBe('ready')
    expect(byId('PRG-01').status).toBe('ready')
    expect(byId('PRG-07').status).toBe('ready')
    expect(byId('PRG-09').status).toBe('partial')
    for (const obligation of inherited) {
      expect(obligation.ownerIssue).toBe(412)
      expect(obligation.status).not.toBe('needs-decision')
      for (const caseId of obligation.caseIds) {
        const linked = coverage.cases.find(item => item.id === caseId)!
        expect(linked.acceptance.frontend).not.toBe('passed')
        expect(linked.acceptance.crossModule).not.toBe('passed')
      }
    }
  })
})
