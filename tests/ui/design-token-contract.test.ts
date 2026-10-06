import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  asRoutes,
  buildCoverage,
  COVERAGE_PATH,
  COVERAGE_STATUSES,
  readCountsBlock,
  readDesignFormRoutes,
  readDesignRegistry,
  renderCountsBlock,
} from '../../scripts/design-coverage.mjs'

const PROJECT_ROOT = process.cwd()
const APP_ROOT = join(PROJECT_ROOT, 'app')
const DESIGN_ROOT = join(
  PROJECT_ROOT,
  'DC重构设计源码/_ds/crm-e3d87120-cf57-4b83-8a9b-188c305f529d',
)
const DESIGN_TOKEN_PATH = join(
  DESIGN_ROOT,
  'tokens/content-v5.css',
)
const DESIGN_STYLES_PATH = join(DESIGN_ROOT, 'styles.css')
const DESIGN_MANIFEST_PATH = join(DESIGN_ROOT, '_ds_manifest.json')
const DESIGN_HTML_PATH = join(PROJECT_ROOT, 'DC重构设计源码/app.dc.html')
const APP_TOKEN_BRIDGE_PATH = join(PROJECT_ROOT, 'app/assets/css/tokens.css')
const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.vue'])
const RUNTIME_TOKEN_PREFIXES = ['--reka-']

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory())
      return sourceFiles(path)
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : []
  })
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function matches(source: string, pattern: RegExp): Set<string> {
  return new Set(Array.from(source.matchAll(pattern), match => match[1]))
}

function importedCssFiles(entry: string, visited = new Set<string>()): string[] {
  if (visited.has(entry))
    return []
  visited.add(entry)

  const source = readFileSync(entry, 'utf8')
  const imports = Array.from(
    source.matchAll(/@import\s+["']([^"']+\.css)["'];/g),
    match => resolve(dirname(entry), match[1]),
  )

  return [
    ...imports.flatMap(path => importedCssFiles(path, visited)),
    entry,
  ]
}

function tokenEntries(file: string) {
  const source = withoutComments(readFileSync(file, 'utf8'))
  return Array.from(
    source.matchAll(/^\s*(--[\w-]+):([^;]+);/gm),
    match => ({
      name: match[1],
      value: match[2].replace(/\s+/g, ' ').trim(),
      definedIn: relative(DESIGN_ROOT, file).replaceAll('\\', '/'),
    }),
  )
}

describe('design token contract', () => {
  it('defines every product CSS variable consumed by the app', () => {
    expect(existsSync(DESIGN_TOKEN_PATH)).toBe(true)

    const designTokenFiles = importedCssFiles(DESIGN_TOKEN_PATH)
    const files = [
      ...sourceFiles(APP_ROOT),
      join(PROJECT_ROOT, 'uno.config.ts'),
      ...designTokenFiles,
    ]
    const source = files
      .map(file => withoutComments(readFileSync(file, 'utf8')))
      .join('\n')
    const references = matches(source, /var\(\s*(--[\w-]+)/g)
    const definitions = matches(source, /(?:^|[;{,\s'"`])(--[\w-]+)['"`]?\s*:/gm)
    const missing = [...references]
      .filter(token => !definitions.has(token))
      .filter(token => !RUNTIME_TOKEN_PREFIXES.some(prefix => token.startsWith(prefix)))
      .sort()

    expect(missing).toEqual([])
  })

  it('keeps shared control and overlay aliases in the canonical token source', () => {
    const definitions = matches(
      withoutComments(readFileSync(DESIGN_TOKEN_PATH, 'utf8')),
      /(?:^|[;{,\s])(--[\w-]+)\s*:/gm,
    )

    const requiredTokens = [
      '--radius-control',
      '--shadow-dialog',
      '--shadow-float',
    ]

    for (const token of requiredTokens)
      expect(definitions.has(token), token).toBe(true)
  })

  it('keeps one owner for each global token across the design entry and app bridge', () => {
    const owners = new Map<string, string[]>()
    const ownerFiles = [
      ...importedCssFiles(DESIGN_TOKEN_PATH),
      APP_TOKEN_BRIDGE_PATH,
    ]

    for (const file of ownerFiles) {
      const definitions = matches(
        withoutComments(readFileSync(file, 'utf8')),
        /(?:^|[;{,\s])(--[\w-]+)\s*:/gm,
      )
      for (const token of definitions)
        owners.set(token, [...(owners.get(token) ?? []), file])
    }

    const duplicates = [...owners]
      .filter(([, files]) => files.length > 1)
      .map(([token, files]) => `${token}: ${files.join(', ')}`)
      .sort()

    expect(duplicates).toEqual([])
  })

  it('keeps the generated manifest aligned with the complete active CSS import graph', () => {
    const manifest = JSON.parse(readFileSync(DESIGN_MANIFEST_PATH, 'utf8'))
    const activeTokens = importedCssFiles(DESIGN_STYLES_PATH)
      .flatMap(tokenEntries)

    expect(manifest.globalCssPaths).toEqual(['styles.css'])
    expect(manifest.tokens.map((token: {
      name: string
      value: string
      definedIn: string
    }) => ({
      name: token.name,
      value: token.value,
      definedIn: token.definedIn,
    }))).toEqual(activeTokens)
  })

  it('wires spacing, current design styles and the Nuxt bridge through explicit entries', () => {
    const designTokens = readFileSync(DESIGN_TOKEN_PATH, 'utf8')
    const designStyles = readFileSync(DESIGN_STYLES_PATH, 'utf8')
    const designHtml = readFileSync(DESIGN_HTML_PATH, 'utf8')
    const appBridge = readFileSync(APP_TOKEN_BRIDGE_PATH, 'utf8')

    expect(designTokens).toMatch(/^@import "\.\/typography\.css";\r?\n@import "\.\/spacing\.css";/)
    expect(designStyles).toContain('@import "./tokens/content-v5.css";')
    expect(designStyles).not.toContain('@import "./tokens/colors.css";')
    expect(designStyles).not.toContain('@import "./tokens/spacing.css";')
    expect(designStyles).not.toContain('@import "./tokens/typography.css";')
    expect(designHtml.match(/<link rel="stylesheet"/g)).toHaveLength(1)
    expect(designHtml).toContain('crm-e3d87120-cf57-4b83-8a9b-188c305f529d/styles.css')
    expect(appBridge).toMatch(/^@import ".+\/tokens\/content-v5\.css";/)
  })
})

// 屏幕层契约（#244）：令牌层已由上面的 describe 守住，这里守「实现有的界面设计稿也要有」。
// 生成物 docs/design/design-coverage.json 由 pnpm design:sync-coverage 写入，
// 解析实现与断言共用 scripts/design-coverage.mjs，避免两套真相。
describe('design coverage contract', () => {
  const coverage = () => JSON.parse(readFileSync(COVERAGE_PATH, 'utf8'))

  it('keeps the generated coverage aligned with both live registries', () => {
    const committed = coverage()
    expect(buildCoverage(committed)).toEqual(committed)
  })

  it('resolves every covered landing point to a current PAGE or form registration', () => {
    const registeredRoutes = new Set([
      ...readDesignRegistry().pages.map(page => page.route),
      ...readDesignFormRoutes().map(form => form.route),
    ])
    const invalidTargets = coverage().screenParity.filter((entry: { status: string }) => entry.status === 'covered').flatMap((entry: { appRoute: string, designRoute: string | string[] | null }) =>
      asRoutes(entry.designRoute)
        .filter(route => !registeredRoutes.has(route))
        .map(route => `${entry.appRoute}: ${route}`))
    expect(invalidTargets).toEqual([])
  })

  it.each([
    ['/finance/payment/:id/detail', 'payApplyDetail', 'isPayApplyDetail', 'PayApplyDetailScreen', 'PayApplyDetailScreen.jsx'],
    ['/settings/data-migration', 'dataMigration', 'isDataMigration', 'DataMigrationScreen', 'DataMigrationScreen.jsx'],
    ['/subcontract/quantity/stages', 'quantityStages', 'isQuantityStages', 'QuantityStagesScreen', 'QuantityStagesScreen.jsx'],
    ['/schedule/process-library/:id', 'processLibraryDetail', 'isProcessLibraryDetail', 'ScheduleProcessLibraryDetailScreen', 'ScheduleProcessLibraryDetailScreen.jsx'],
  ])('maps %s to its registered and mounted design screen', (appRoute, route, flag, global, file) => {
    const html = readFileSync(DESIGN_HTML_PATH, 'utf8')
    const mapping = coverage().screenParity.find((entry: { appRoute: string }) => entry.appRoute === appRoute)
    expect(mapping).toEqual({ appRoute, designRoute: route, status: 'covered' })
    expect(readDesignRegistry().pages.some(page => page.route === route)).toBe(true)
    expect(html).toContain(`${flag}: route === "${route}"`)
    const mount = html.match(new RegExp(`<sc-if value="\\{\\{ ${flag} \\}\\}"[^>]*>[\\s\\S]*?<\\/sc-if>`))?.[0]
    expect(mount, `${route} 的路由开关必须实际挂载屏幕`).toContain(`component-from-global-scope="${global}" from="./kit/${file}"`)
    const source = readFileSync(join(PROJECT_ROOT, 'DC重构设计源码/kit', file), 'utf8')
    expect(source).toContain(`window.${global} = ${global}`)
  })

  it('registers every screen that has no design landing point', () => {
    const { screenParity, designOnly, navTitleVariants } = coverage()

    const unknownStatus = [...screenParity, ...designOnly]
      .filter((entry: { status: string }) => !COVERAGE_STATUSES.includes(entry.status))
      .map((entry: { appRoute?: string, designRoute?: string, status: string }) =>
        `${entry.appRoute ?? entry.designRoute}: ${entry.status}`)
    expect(unknownStatus).toEqual([])

    // 未覆盖必须写明原因；design-pending 还必须挂归属 Issue，否则缺口会无声堆积
    const missingReason = [...screenParity, ...designOnly, ...navTitleVariants]
      .filter((entry: { status?: string, reason?: string }) =>
        entry.status !== 'covered' && !entry.reason?.trim())
      .map((entry: { appRoute?: string, designRoute?: string, key?: string }) =>
        entry.appRoute ?? entry.designRoute ?? entry.key)
    expect(missingReason).toEqual([])

    const missingIssue = screenParity
      .filter((entry: { status: string, issue?: number }) =>
        entry.status === 'design-pending' && !entry.issue)
      .map((entry: { appRoute: string }) => entry.appRoute)
    expect(missingIssue).toEqual([])

    const coveredWithoutTarget = screenParity
      .filter((entry: { status: string, designRoute: unknown }) =>
        entry.status === 'covered' && !entry.designRoute)
      .map((entry: { appRoute: string }) => entry.appRoute)
    expect(coveredWithoutTarget).toEqual([])
  })

  it('keeps sidebar labels identical between the app and the design source', () => {
    const { navParity } = coverage()

    const pendingRoutes = new Set(coverage().screenParity.filter((entry: { status: string, issue?: string }) => entry.status === 'design-pending' && entry.issue).map((entry: { appRoute: string }) => entry.appRoute))
    const missingInDesign = navParity
      .filter((entry: { designLabel: string | null, appNavTo: string | null }) =>
        !entry.designLabel && !pendingRoutes.has(entry.appNavTo ?? ''))
      .map((entry: { key: string }) => entry.key)
    expect(missingInDesign).toEqual([])

    const mismatched = navParity
      .filter((entry: { appLabel: string, designLabel: string | null }) =>
        entry.designLabel !== null && entry.appLabel !== entry.designLabel)
      .map((entry: { key: string, appLabel: string, designLabel: string | null }) =>
        `${entry.key}: app「${entry.appLabel}」/ design「${entry.designLabel}」`)
    expect(mismatched).toEqual([])
  })

  it('keeps the implementation-status numbers generated from the same source', () => {
    // ui-implementation-status.md 曾把两个已实现界面长期写成「未实现」；数字改为生成块后不可能再静默过期
    expect(readCountsBlock()).toBe(renderCountsBlock(coverage().counts))
  })

  it('pins every external dependency loaded by the design entry', () => {
    const { externalScripts, stylesheets } = readDesignRegistry()

    // @latest 会随上游变化，设计稿必须可复现
    const unpinned = externalScripts.filter(url => !/@\d+\.\d+\.\d+(?:$|\/)/.test(url))
    expect(unpinned).toEqual([])
    expect(stylesheets).toHaveLength(1)
  })
})
