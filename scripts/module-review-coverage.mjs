import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROJECT_ROOT, readAppPageFiles } from './design-coverage.mjs'
import { ADAPTERS, OBSERVATION_DATE, PUBLIC_SURFACES, REFERENCE_MENUS, resolveAdapter, SOURCE_BASELINE, SUBVIEWS } from './module-review-inventory.mjs'
import { OBLIGATION_STATUS_LABELS, REVIEW_OBLIGATIONS, validateReviewObligations } from './module-review-obligations.mjs'
import { buildRuntimeEvidenceLedger } from './runtime-evidence-ledger.mjs'

export const MODULE_REVIEW_COVERAGE_PATH = join(PROJECT_ROOT, 'docs/design/module-review-coverage.json')
export const MODULE_REVIEW_INDEX_PATH = join(PROJECT_ROOT, 'docs/design/module-review-coverage.md')

function stableId(prefix, values) {
  return `${prefix}-${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 12).toUpperCase()}`
}

function sourceText(path) {
  return readFileSync(join(PROJECT_ROOT, path), 'utf8').replaceAll('\r\n', '\n')
}

function checkSource([path, anchor]) {
  if (!sourceText(path).includes(anchor))
    throw new Error(`module-review-coverage: 源码锚点失效 ${path} -> ${anchor}`)
  return { path, anchor }
}

// 只解析注册表外层字面键，不执行应用模块（它们依赖 Nuxt 注入与业务 stores）。
// 未能读取 scope/kind 的新注册项立即失败，避免新单据被静默遗漏。
function readOwnerKinds() {
  const source = sourceText('app/lib/owner-document/page.ts')
  const registry = source.slice(source.indexOf('export const OWNER_DOCUMENT_META:'))
  const blocks = [...registry.matchAll(/^ {2}(\w+): \{\n([\s\S]*?)^ {2}\},/gm)]
  return blocks.map(([, kind, block]) => {
    const scope = block.match(/routeScope: '(\w+)'/)?.[1]
    const routeKind = block.match(/routeKind: '([\w-]+)'/)?.[1]
    if (!scope || !routeKind)
      throw new Error(`module-review-coverage: 无法解析单据注册 ${kind}`)
    const sections = [...block.matchAll(/\{ key: '(\w+)', label:/g)].map(match => match[1])
    return { kind, scope, routeKind, sections }
  })
}

function readImportEntities() {
  const source = sourceText('app/lib/kit/import-entities.ts')
  const registry = source.slice(source.indexOf('export const IMPORT_ENTITIES:'))
  return [...registry.matchAll(/^ {2}'([\w-]+)': \{\n {4}key: '([\w-]+)'/gm)].map(([, key, identity]) => {
    if (key !== identity)
      throw new Error(`module-review-coverage: 导入注册 key 不一致 ${key}/${identity}`)
    return key
  })
}

function baseMode(endpoint) {
  if (endpoint.localRoute.includes(':id?'))
    return null
  if (endpoint.template !== '整页表单')
    return 'view'
  return endpoint.localRoute.endsWith(':id') ? 'edit' : 'new'
}

function staticKind(route) {
  if (route.startsWith('/contract/') && !route.startsWith('/contract/boq'))
    return route.split('/')[2].replaceAll('-', '_')
  if (route.startsWith('/base/'))
    return route.split('/')[2]
  if (route === '/project/penalty' || route.startsWith('/project/penalty/'))
    return 'project_penalty'
  if (route === '/material/settlement' || route.startsWith('/material/settlement/'))
    return 'material_settlement'
  if (route.startsWith('/finance/'))
    return route.split('/')[2]
  return route.split('/').filter(part => part && !part.startsWith(':') && !['form', 'new', 'detail'].includes(part)).join('.') || 'home'
}

function routeVariants(endpoint, registry) {
  const route = endpoint.localRoute
  const modes = baseMode(endpoint) === null ? ['new', 'edit'] : [baseMode(endpoint)]
  if (route.includes(':kind')) {
    const scope = route.split('/')[1]
    return registry.ownerKinds.filter(item => item.scope === scope).flatMap((item) => {
      const rows = [{ kind: item.kind, variant: 'default', routePattern: route.replace(':kind', item.routeKind), mode: modes[0], condition: `routeScope=${scope}; routeKind=${item.routeKind}`, sections: item.sections }]
      if (item.kind === 'acceptance' && endpoint.template !== '整页表单')
        rows.push({ ...rows[0], variant: 'warranty', condition: `${rows[0].condition}; variant=warranty`, routePattern: `${rows[0].routePattern}?variant=warranty` })
      return rows
    })
  }
  if (route === '/import/mapping/:entity')
    return registry.importEntities.map(kind => ({ kind, variant: 'default', routePattern: route.replace(':entity', kind), mode: 'view', condition: `entity=${kind}` }))
  if (route === '/contract/:id') {
    return [
      ...['construction', 'material', 'subcontract'].map(kind => ({ kind, variant: 'central', routePattern: `${route}?contractKind=${kind}&origin=:origin`, mode: 'view', hosts: ['browser'], condition: `非桌面；contractKind=${kind} 且 origin=real|demo` })),
      ...['施工', '分包', '材采'].map(kind => ({ kind, variant: 'legacy', routePattern: route, mode: 'view', condition: '桌面，或未满足中央 contractKind + origin marker；不是中央读取失败后回退' })),
    ]
  }
  if (route === '/contract/boq/import')
    return registry.boqFormats.map(format => ({ kind: 'boq', variant: `format-${format}`, routePattern: route, mode: 'view', condition: `BoqFormatClass=${format}；格式来自实际解析结果` }))
  if (route === '/finance/invoice')
    return ['review', 'print'].map(variant => ({ kind: 'invoice', variant, routePattern: route, mode: 'view', condition: `workspaceMode=${variant}` }))
  if (route === '/subcontract/quantity')
    return ['trade', 'crew'].map(variant => ({ kind: 'quantity', variant, routePattern: route, mode: 'view', condition: `viewMode=${variant}；矩阵 unassigned/assigned/draft/completed 分别验收` }))
  if (['/subcontract/quantity/:pid/:uid', '/subcontract/payroll/:id', '/project/penalty/:id'].includes(route)) {
    return [
      { kind: staticKind(route), variant: 'default', routePattern: route, mode: 'view', condition: '未满足中央 origin + ownerKind + ownerId 来源标记' },
      ...['crew', 'worker'].map(owner => ({ kind: staticKind(route), variant: 'central-source', routePattern: `${route}?ownerKind=${owner}&ownerId=:ownerId&origin=:origin`, mode: 'view', condition: `ownerKind=${owner}；有效 origin 和 ownerId`, identity: owner })),
    ]
  }
  if (route === '/subcontract/quantity/template')
    return ['new', 'edit'].map(mode => ({ kind: 'quantity-template', variant: 'default', routePattern: route, mode, condition: mode === 'new' ? '组件内未选 selectedTemplateId' : '组件内 selectDraft(templateId) 或 boqLine 预选；不是 query id' }))
  if (route === '/schedule/process-library/form')
    return ['new', 'copy-version'].map(variant => ({ kind: 'process-library', variant, routePattern: route + (variant === 'copy-version' ? '?source=:versionId' : ''), mode: 'new', condition: variant === 'copy-version' ? '基于 source 旧版本新建，旧版只读' : '不带 source' }))
  return modes.map(mode => ({
    kind: staticKind(route),
    variant: 'default',
    mode,
    routePattern: route.includes(':id?') ? route.replace('/:id?', mode === 'new' ? '' : '/:id') : route,
    condition: route.includes(':id?') ? (mode === 'new' ? '未传 id' : '有效 id') : '按现有路由和 capability',
  }))
}

function matches(surface, selector) {
  return Object.entries(selector).every(([key, values]) => (Array.isArray(values) ? values : [values]).includes(surface[key]))
}

function makeSurface(endpoint, variant, view) {
  const identity = [endpoint.localRoute, variant.kind, variant.variant, variant.identity ?? '', variant.mode, view.path]
  return {
    id: stableId('S', identity),
    route: endpoint.localRoute,
    routePattern: variant.routePattern,
    domain: endpoint.domainCode,
    kind: variant.kind,
    variant: variant.variant,
    branchIdentity: variant.identity ?? '',
    mode: variant.mode,
    template: endpoint.template,
    path: view.path,
    label: view.label,
    type: view.type,
    condition: [variant.condition, view.condition].filter(Boolean).join('；'),
    hosts: view.hosts ?? variant.hosts ?? ['browser', 'tauri'],
    sources: [[endpoint.page, '<template'], ...(view.sources ?? [])].map(checkSource),
    issueNumbers: [...new Set([...endpoint.implementationIssues, ...(view.issues ?? [])])],
    routeEvidenceId: endpoint.evidenceRecordId,
  }
}

function buildSurfaces(ledger, registry) {
  const surfaces = []
  for (const endpoint of ledger.endpoints) {
    const variants = routeVariants(endpoint, registry)
    if (!variants.length)
      throw new Error(`module-review-coverage: 路由无实际变体 ${endpoint.localRoute}`)
    for (const variant of variants) {
      const root = makeSurface(endpoint, variant, { path: 'page', label: endpoint.template, type: 'page' })
      surfaces.push(root)
      if (endpoint.localRoute === '/import/mapping/:entity') {
        const projectImport = variant.kind === 'project'
        const stepSource = projectImport ? 'app/composables/useProjectImport.ts' : endpoint.page
        for (const step of ['upload', 'mapping', 'preview-import'])
          surfaces.push(makeSurface(endpoint, variant, { path: `step/${step}`, label: step, type: 'wizard-step', sources: [[stepSource, `'${step}'`]] }))
        surfaces.push(makeSurface(endpoint, variant, { path: 'step/preview-import/rejected', label: '拒绝行与来源', type: 'subtable', sources: projectImport ? [['app/components/project/ProjectImportScreen.vue', '项目行级拒绝清单']] : [[endpoint.page, 'rejectionRowNumber']] }))
      }
      if (endpoint.localRoute.includes(':kind') && endpoint.template === '整页表单') {
        for (const section of variant.sections)
          surfaces.push(makeSurface(endpoint, variant, { path: `section/${section}`, label: section, type: 'form-section', sources: [['app/lib/owner-document/page.ts', `key: '${section}'`]] }))
      }
      for (const group of SUBVIEWS.filter(group => matches(root, group.selector))) {
        for (const view of group.views)
          surfaces.push(makeSurface(endpoint, variant, { ...view, sources: [[group.source, view.anchor ?? group.anchor]], hosts: group.hosts, issues: group.issues }))
      }
    }
  }
  const ids = surfaces.map(surface => surface.id)
  if (new Set(ids).size !== ids.length)
    throw new Error('module-review-coverage: 重复的 route/kind/variant/mode/path 身份')
  return surfaces
}

function caseFor(surface, host) {
  const materialList = surface.route === '/contract/material' && surface.path === 'page' && host === 'browser'
  const projectImport = surface.route === '/import/mapping/:entity' && surface.kind === 'project' && host === 'browser'
  const customerProjects = host === 'browser' && (
    (surface.route === '/base/customer/:id' && ['page', 'tab/projects', 'tab/projects/table'].includes(surface.path))
    || (surface.route === '/project/:id' && surface.path === 'page')
  )
  return {
    id: stableId('C', [surface.id, host]),
    surfaceId: surface.id,
    host,
    adapter: resolveAdapter(surface, host),
    applicability: host === 'tauri' ? 'existing-capabilities-only; formal-delivery-excluded' : 'in-scope',
    sourceState: surface.type === 'unlinked-placeholder' ? 'placeholder-not-implemented' : 'wired-needs-action-audit',
    reference: {
      status: materialList ? 'scoped-observation' : 'not-observed',
      routeEvidenceId: surface.routeEvidenceId,
      note: '父路由证据只作入口索引，不继承为本 kind/子视图/宿主的直接证据',
    },
    acceptance: {
      rules: materialList || projectImport || customerProjects ? 'scoped-defined' : 'needs-review',
      frontend: projectImport ? 'passed' : materialList || customerProjects ? 'partial' : 'not-verified',
      crossModule: projectImport || customerProjects ? 'passed' : materialList ? 'partial' : 'not-verified',
      production: host === 'tauri' ? 'out-of-scope' : 'not-verified',
    },
    reviewEvidence: customerProjects ? ['docs/design/evidence/issue-424/customer-project-verification.md'] : projectImport ? ['docs/design/evidence/issue-423/project-import-verification.md'] : materialList ? ['docs/design/evidence/issue-422/README.md'] : [],
    remaining: customerProjects ? ['#424 仅验收中央项目→客户关联回读及往返；其他关联、逐列工具由 #407/#408/#404 继续复核，生产持久化归 #416'] : projectImport ? ['生产持久化由 #416 验收；外部旧 ID 仅本 Excel 回执防重，不核对整库迁移映射'] : materialList ? ['逐列筛选、排序、设置和文件工具仍由 #404/#409 复核'] : ['逐动作及正常/边界/失败/重复/更正/跨域场景待核验'],
  }
}

export function buildModuleReviewCoverage() {
  const routeLedger = buildRuntimeEvidenceLedger()
  const boqDefinition = sourceText('app/lib/boq/import.ts').match(/export type BoqFormatClass = ([^\n]+)/)?.[1] ?? ''
  const registry = { ownerKinds: readOwnerKinds(), importEntities: readImportEntities(), boqFormats: [...boqDefinition.matchAll(/'([^']+)'/g)].map(match => match[1]) }
  if (!registry.ownerKinds.length || !registry.importEntities.length || !registry.boqFormats.length)
    throw new Error('module-review-coverage: 动态注册表为空或解析失效')
  const surfaces = buildSurfaces(routeLedger, registry)
  const cases = surfaces.flatMap(surface => surface.hosts.map(host => caseFor(surface, host)))
  validateReviewObligations(REVIEW_OBLIGATIONS, cases)
  for (const obligation of REVIEW_OBLIGATIONS) {
    for (const reference of [...obligation.sources, ...obligation.evidence.map(item => item.reference)]) {
      if (!reference.startsWith('https://'))
        sourceText(reference)
    }
  }
  return {
    schemaVersion: 1,
    sourceBaseline: SOURCE_BASELINE,
    sourceInspectedAt: OBSERVATION_DATE,
    scope: '源码覆盖索引，非全模块运行验收；未列出的运行状态继续按 module-review 规程扩展',
    registry,
    counts: { productionRoutes: routeLedger.endpoints.length, rootVariants: surfaces.filter(surface => surface.path === 'page').length, surfaces: surfaces.length, environmentCases: cases.length, referenceMenus: REFERENCE_MENUS.length },
    excludedDevPages: readAppPageFiles().filter(page => page.startsWith('dev/')).map(page => `app/pages/${page}`),
    adapterProfiles: Object.fromEntries(Object.entries(ADAPTERS).map(([key, value]) => [key, { ...value, sources: value.sources.map(checkSource) }])),
    referenceMenus: REFERENCE_MENUS,
    publicSurfaces: PUBLIC_SURFACES.map(item => ({ ...item, source: checkSource([item.source, item.anchor]), status: 'needs-scenario-audit', acceptance: 'not-verified' })),
    domains: routeLedger.domains.map(domain => ({ code: domain.code, label: domain.domain, issues: domain.implementationIssues, surfaces: surfaces.filter(surface => surface.domain === domain.code).length })),
    surfaces,
    obligations: REVIEW_OBLIGATIONS,
    cases: cases.map(item => ({ ...item, obligationIds: REVIEW_OBLIGATIONS.filter(obligation => obligation.caseIds.includes(item.id)).map(obligation => obligation.id) })),
  }
}

function link(path) {
  return `[${path}](../../${path})`
}

export function renderModuleReviewIndex(coverage) {
  const lines = [
    '# 全模块复核覆盖索引',
    '',
    `源码采证基线：\`${coverage.sourceBaseline}\`，日期 ${coverage.sourceInspectedAt}。本页和同名 JSON 由 \`node scripts/sync-module-review-coverage.mjs\` 生成。`,
    '',
    '本索引负责防遗漏，不定义业务规格，也不是完成率。路由来源为 [运行证据账本](./runtime-evidence-ledger.json)；子视图和宿主接线来自实际源码。父路由的 direct/historical 等级不自动赋给子视图。逐场景规则、差异和验收继续写入 [模块复核规程](../agents/module-review.md) 指定的当前 Issue。',
    '',
    `现有 ${coverage.counts.productionRoutes} 条生产路由展开为 ${coverage.counts.rootVariants} 个路由变体、${coverage.counts.surfaces} 个页面/子视图、${coverage.counts.environmentCases} 个宿主用例。另有 ${coverage.excludedDevPages.length} 个 dev 路由；这些数量均不表示已验收。`,
    '',
    '实际记录见 [可机读清单](./module-review-coverage.json)：surfaces 保存 route + kind + variant + mode + path，cases 再按 browser/tauri 展开，分别保存读写适配器、参考范围、验收结果和剩余缺口。规则已定、前台通过、跨域通过、生产可用独立记录。#422 只登记材料合同浏览器列表已覆盖切片，整页仍为 partial；中央 Map、IndexedDB 刷新读回都没有生产可用结论。',
    '',
    '源码清点仍需逐模块补全动作、合法状态、附件正文及审计细节。新增动态注册、路由或已登记源码锚点变化时运行生成器并审查差异；不要把自动新增行提升为验收通过。',
    '',
    '## 旧验收义务承接（已登记范围）',
    '',
    `当前登记 ${coverage.obligations.length} 项，限定 OCR 设置、核心迁移、付款结算口径及因子工具。#431 只登记该范围，不代表全部历史任务已映射；剩余模块由 #415 继续补齐。输入为 scripts/module-review-obligations.mjs，JSON obligations 保存来源、唯一承接、适用 case ID、范围和固定证据提交，cases.obligationIds 提供反向索引。`,
    '',
    '义务的“本轮限定范围已验证”不提升所在页面、其他宿主或生产可用等级。历史评论和源码检查分别标记，不冒充本轮运行；状态为已定待实施的条目沿用有效决定，不重新提问。',
    '',
    '| 义务 / 原条款 | 当前承接 | 状态 | 证据及限制 |',
    '| --- | --- | --- | --- |',
    ...coverage.obligations.map(item => `| ${item.id} · ${item.label}（${item.sources.map((source, index) => source.startsWith('https://') ? `[来源${index + 1}](${source})` : link(source)).join('、')}） | [#${item.ownerIssue}](https://github.com/zodea/crm-new/issues/${item.ownerIssue}) | ${OBLIGATION_STATUS_LABELS[item.status]} | ${item.evidence.map(evidence => `${evidence.reference.startsWith('https://') ? `[记录](${evidence.reference})` : link(evidence.reference)}${evidence.commit ? ` @ \`${evidence.commit.slice(0, 8)}\`` : ''}（${evidence.recency}）`).join('、') || '待补证据'}；${item.remaining} |`),
    '',
    '## 宿主与读写边界',
    '',
    '| 标识 | 读取 | 写入边界 | 实际存储/限制 |',
    '| --- | --- | --- | --- |',
    ...Object.entries(coverage.adapterProfiles).map(([key, profile]) => `| ${key} | ${profile.read} | ${profile.write} | ${profile.storage} |`),
    '',
    'Tauri 只核验已有功能，正式交付按 #402 排除。HTTP Repository 未按宿主自动换成 SQLite；项目列表/详情、客户/分供方列表/详情和部分关系详情在桌面仍是 HTTP。所有未附实际运行证据的宿主用例为待验收。',
    '',
    '## 红圈可见菜单双向映射',
    '',
    '以下只证明登录会话中入口名称可见，不能证明子页面、保存、空数据或私有接口行为。pending 是待调查映射，不是排除。瑞航独有的工程量、工资、OCR、迁移等按下方本地路由索引和当前规格验收。',
    '',
    '| 菜单 | 本地候选/对应 | 映射状态 | 承接与边界 |',
    '| --- | --- | --- | --- |',
    ...coverage.referenceMenus.map(item => `| ${item.group} / ${item.label} | ${item.localTargets.map(route => `\`${route}\``).join('、') || '—'} | ${item.mappingStatus} | ${item.issues.map(issue => `#${issue}`).join('/')} ${item.note} |`),
    '',
    '## 无独立路由的公共能力',
    '',
    ...coverage.publicSurfaces.map(item => `- ${item.label}：${link(item.source.path)}；${item.issues.map(issue => `#${issue}`).join('/')}；逐场景待核验。`),
    '',
    '## 本地路由、变体与子视图',
    '',
    '每行的 browser / tauri 列是接线事实，实际验收在 JSON cases 内逐宿主记录。page 是完整页面；tab、section、table、pane、dialog、step 是需单独采证的子面。动态记录 ID、项目、来源 real/demo、权限和失败状态在相应 Issue 的场景表继续展开，不能用一条合成样本替代全部适用场景。',
    '',
  ]
  for (const domain of coverage.domains) {
    lines.push(`### ${domain.label}（${domain.issues.map(issue => `#${issue}`).join('/')}）`, '', '| 路由变体 / mode | kind / variant | 子视图 | browser / tauri | 源码 |', '| --- | --- | --- | --- | --- |')
    for (const surface of coverage.surfaces.filter(item => item.domain === domain.code)) {
      const adapters = ['browser', 'tauri'].map(host => coverage.cases.find(item => item.surfaceId === surface.id && item.host === host)?.adapter ?? '不适用')
      const source = surface.sources.at(-1)
      lines.push(`| \`${surface.routePattern}\` ${surface.mode} | ${surface.kind} / ${surface.variant} | ${surface.path} · ${surface.label} | ${adapters.join(' / ')} | ${link(source.path)} |`)
    }
    lines.push('')
  }
  return `${lines.join('\n').trimEnd()}\n`
}
