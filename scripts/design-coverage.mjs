// 设计覆盖契约的共享解析层：脚本与 tests/ui/design-token-contract.test.ts 共用同一份实现，
// 避免生成物与断言各自解析出两套"真相"。纯函数 + 只读文件，无副作用。
//
// 两侧口径：
//   设计稿侧 = DC重构设计源码/app.dc.html 的 PAGE / NAV / <x-import> 三处注册表
//              + kit/forms/*.jsx 的 KF.registerForm 整页表单注册
//   实现侧   = app/lib/nav/nav-tree.ts 的叶子 to（IA 口径）
//              + app/pages/**/*.vue 推导出的路由（屏口径）

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DESIGN_HTML_PATH = join(PROJECT_ROOT, 'DC重构设计源码/app.dc.html')
export const DESIGN_FORMS_DIR = join(PROJECT_ROOT, 'DC重构设计源码/kit/forms')
export const NAV_TREE_PATH = join(PROJECT_ROOT, 'app/lib/nav/nav-tree.ts')
export const PAGES_ROOT = join(PROJECT_ROOT, 'app/pages')
export const COVERAGE_PATH = join(PROJECT_ROOT, 'docs/design/design-coverage.json')
export const STATUS_DOC_PATH = join(PROJECT_ROOT, 'docs/design/ui-implementation-status.md')
export const COVERAGE_BLOCK_BEGIN = '<!-- design-coverage:begin -->'
export const COVERAGE_BLOCK_END = '<!-- design-coverage:end -->'

/** ui-implementation-status.md 的生成块正文：唯一实现，脚本写入、测试断言都走这里。 */
export function renderCountsBlock(counts) {
  return [
    '| 口径 | 数量 |',
    '| --- | ---: |',
    `| 设计稿 PAGE 路由 | ${counts.designPageRoutes} |`,
    `| 设计稿整页表单路由 | ${counts.designFormRoutes} |`,
    `| 设计稿侧栏分组 / 叶子 | ${counts.designNavGroups} / ${counts.designNavLeaves} |`,
    `| 实现生产路由（排除 dev） | ${counts.appPageFiles} |`,
    `| 实现侧栏叶子 | ${counts.appNavLeaves} |`,
    `| 已覆盖 | ${counts.covered} |`,
    `| 待补设计（实现有、设计稿没有） | ${counts.designPending} |`,
    `| 已退役（设计稿有、实现不做） | ${counts.retired} |`,
  ].join('\n')
}

/**
 * 读出文档里两个标记之间的正文（不含标记行本身）。
 * 行尾统一归一为 LF：git 在 Windows 检出时会把文件转成 CRLF，
 * 而 renderCountsBlock 产出 LF —— 不归一会让内容相同的块被判为不等。
 */
export function readCountsBlock(docPath = STATUS_DOC_PATH) {
  const source = readFileSync(docPath, 'utf8').replaceAll('\r\n', '\n')
  const from = source.indexOf(COVERAGE_BLOCK_BEGIN)
  const to = source.indexOf(COVERAGE_BLOCK_END)
  if (from < 0 || to < 0 || to < from)
    throw new Error('design-coverage: ui-implementation-status.md 缺少 design-coverage 生成块标记')
  return source.slice(from + COVERAGE_BLOCK_BEGIN.length, to).trim()
}

/** 把生成块写回文档，只替换标记之间的内容。 */
export function replaceCountsBlock(source, counts) {
  const from = source.indexOf(COVERAGE_BLOCK_BEGIN)
  const to = source.indexOf(COVERAGE_BLOCK_END)
  if (from < 0 || to < 0 || to < from)
    throw new Error('design-coverage: ui-implementation-status.md 缺少 design-coverage 生成块标记')
  const head = source.slice(0, from + COVERAGE_BLOCK_BEGIN.length)
  const tail = source.slice(to)
  return `${head}\n${renderCountsBlock(counts)}\n${tail}`
}

/** 合法状态：仅此三值。非 covered 必须给 reason；design-pending 必须给 issue。 */
export const COVERAGE_STATUSES = ['covered', 'design-pending', 'retired']

/** designRoute 允许字符串或数组（动态 kind 路由一条 app 路由对应多个设计屏）。 */
export function asRoutes(designRoute) {
  if (!designRoute)
    return []
  return Array.isArray(designRoute) ? designRoute : [designRoute]
}

/** 取 `start` 之后到首个位于行首的 `end` 之间的文本块（注册表都是顶层字面量，行首闭合可靠）。 */
function literalBlock(source, start, end) {
  const from = source.indexOf(start)
  if (from < 0)
    throw new Error(`design-coverage: 未找到起始标记 ${start}`)
  const rest = source.slice(from + start.length)
  const to = rest.search(new RegExp(`^${end.replace(/[[\]{}()*+?.\\^$|]/g, '\\$&')}`, 'm'))
  if (to < 0)
    throw new Error(`design-coverage: 未找到结束标记 ${end}`)
  return rest.slice(0, to)
}

/** 逐行抓取同一行内同时出现的两个双引号字段（NAV 的 payManage.hint 是 IIFE，只能按行解析）。 */
function pairsByLine(block, firstKey, secondKey) {
  const first = new RegExp(`${firstKey}:\\s*"([^"]+)"`)
  const second = new RegExp(`${secondKey}:\\s*"([^"]*)"`)
  return block.split(/\r?\n/).flatMap((line) => {
    const a = first.exec(line)
    const b = second.exec(line)
    return a && b ? [{ [firstKey]: a[1], [secondKey]: b[1] }] : []
  })
}

/** 设计稿注册表：PAGE 词条、NAV 分组与叶子、x-import 装载的屏。 */
export function readDesignRegistry(htmlPath = DESIGN_HTML_PATH) {
  const html = readFileSync(htmlPath, 'utf8')

  // PAGE 的 key 不带引号：`  route: { title: "…", subtitle: "…" },`
  const pageBlock = literalBlock(html, 'const PAGE = {', '};')
  const pages = Array.from(
    pageBlock.matchAll(/^\s*(\w+):\s*\{\s*title:\s*"([^"]+)"\s*,\s*subtitle:\s*"([^"]*)"\s*\}/gm),
    match => ({ route: match[1], title: match[2], subtitle: match[3] }),
  )

  const navBlock = literalBlock(html, 'const NAV = [', '    ];')
  const navGroups = Array.from(
    navBlock.matchAll(/type:\s*"group"\s*,\s*key:\s*"([^"]+)"\s*,\s*label:\s*"([^"]+)"/g),
    match => ({ key: match[1], label: match[2] }),
  )
  const navLeaves = pairsByLine(navBlock, 'key', 'label')
    .filter(entry => !entry.key.startsWith('g-'))
    .map(entry => ({ key: entry.key, label: entry.label }))

  const screens = Array.from(
    html.matchAll(/component-from-global-scope="([^"]+)"\s+from="\.\/kit\/([^"]+)"/g),
    match => ({ global: match[1], file: `kit/${match[2]}` }),
  )

  const stylesheets = Array.from(
    html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"/g),
    match => match[1],
  )
  const externalScripts = Array.from(
    html.matchAll(/<script\s+src="(https?:\/\/[^"]+)"/g),
    match => match[1],
  )

  return { pages, navGroups, navLeaves, screens, stylesheets, externalScripts }
}

/** kit/forms/*.jsx 注册的整页表单路由。 */
export function readDesignFormRoutes(formsDir = DESIGN_FORMS_DIR) {
  return readdirSync(formsDir)
    .filter(name => extname(name) === '.jsx')
    .flatMap(name => Array.from(
      readFileSync(join(formsDir, name), 'utf8').matchAll(
        /registerForm\(\s*"([^"]+)"\s*,\s*\{\s*title:\s*"([^"]+)"[\s\S]{0,400}?listRoute:\s*"([^"]+)"/g,
      ),
      match => ({ route: match[1], title: match[2], listRoute: match[3], definedIn: `kit/forms/${name}` }),
    ))
    .sort((a, b) => a.route.localeCompare(b.route))
}

/** 实现侧侧栏叶子：key / label / to（to 缺省 = 未实装占位）。 */
export function readAppNavLeaves(navTreePath = NAV_TREE_PATH) {
  const source = readFileSync(navTreePath, 'utf8')
  const block = literalBlock(source, 'export const NAV_TREE: NavNode[] = [', ']')
  return block.split(/\r?\n/).flatMap((line) => {
    const key = /key:\s*'([^']+)'/.exec(line)
    const label = /label:\s*'([^']+)'/.exec(line)
    if (!key || !label || key[1].startsWith('g-'))
      return []
    const to = /\bto:\s*'([^']+)'/.exec(line)
    return [{ key: key[1], label: label[1], ...(to ? { to: to[1] } : {}) }]
  })
}

/** 实现侧侧栏分组。 */
export function readAppNavGroups(navTreePath = NAV_TREE_PATH) {
  const source = readFileSync(navTreePath, 'utf8')
  const block = literalBlock(source, 'export const NAV_TREE: NavNode[] = [', ']')
  return Array.from(
    block.matchAll(/type:\s*'group'\s*,\s*key:\s*'([^']+)'\s*,\s*label:\s*'([^']+)'/g),
    match => ({ key: match[1], label: match[2] }),
  )
}

/** app/pages 文件名 → Nuxt 路由。`[[id]]` → :id?，`[id]` → :id，index 归父级。 */
export function pageFileToRoute(relativePath) {
  const segments = relativePath.replaceAll('\\', '/').replace(/\.vue$/, '').split('/')
  const mapped = segments
    .map(segment => segment
      .replace(/^\[\[(.+)\]\]$/, ':$1?')
      .replace(/^\[(.+)\]$/, ':$1'))
    .filter((segment, index) => !(segment === 'index' && index === segments.length - 1))
  return `/${mapped.join('/')}`.replace(/\/$/, '') || '/'
}

/** 枚举 app/pages 下全部页面路由（dev/ 为开发者调试页，按 ui-implementation-status 口径排除）。 */
export function readAppRoutes(pagesRoot = PAGES_ROOT) {
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name)
      if (entry.isDirectory())
        return walk(path)
      return extname(entry.name) === '.vue' ? [path] : []
    })
  }

  return walk(pagesRoot)
    .map(path => pageFileToRoute(relative(pagesRoot, path)))
    .filter(route => !route.startsWith('/dev/'))
    .sort()
}

/**
 * 由注册表机械推导 app 路由的设计稿落点。只覆盖口径确定的三类，其余交人工登记：
 *   1. 列表页：路由与某个 nav 叶子的 to 完全相同 → 该叶子 key（须在 PAGE 中）
 *   2. 新建/编辑整页表单：<to>/new、<to>/form、<to>/form/:id(?) → listRoute 指向该叶子的 registerForm
 *   3. <to>/:id：PAGE 有 `<key>Detail` 走详情；否则若该域有整页表单则视为编辑态（ADR 0014）
 * 返回 null 表示推导不出，必须显式登记。
 */
export function deriveDesignRoute(appRoute, { navLeaves, designPageRoutes, formsByListRoute }) {
  const exact = navLeaves.find(leaf => leaf.to === appRoute)
  if (exact)
    return designPageRoutes.has(exact.key) ? exact.key : null

  const formSuffix = /\/(?:new|form)(?:\/:\w+\??)?$/
  const idSuffix = /\/:\w+\??$/

  const base = appRoute.replace(formSuffix, '')
  if (base !== appRoute) {
    const leaf = navLeaves.find(item => item.to === base)
    return leaf ? formsByListRoute.get(leaf.key) ?? null : null
  }

  const idBase = appRoute.replace(idSuffix, '')
  if (idBase !== appRoute) {
    const leaf = navLeaves.find(item => item.to === idBase)
    if (!leaf)
      return null
    const detailRoute = `${leaf.key}Detail`
    if (designPageRoutes.has(detailRoute))
      return detailRoute
    return formsByListRoute.get(leaf.key) ?? null
  }

  return null
}

/**
 * 合成覆盖清单。
 * `curated` 为已提交的 design-coverage.json：其 status / designRoute / reason / issue 被保留，
 * 新出现的 app 路由一律以 design-pending + 空 reason 落盘，逼人显式登记（测试会因空 reason 变红）。
 */
export function buildCoverage(curated = {}) {
  const design = readDesignRegistry()
  const designForms = readDesignFormRoutes()
  const appRoutes = readAppRoutes()
  const appNavLeaves = readAppNavLeaves()
  const designPageRoutes = new Set(design.pages.map(page => page.route))

  const previousScreens = new Map(
    (curated.screenParity ?? []).map(entry => [entry.appRoute, entry]),
  )
  const previousDesignOnly = new Map(
    (curated.designOnly ?? []).map(entry => [entry.designRoute, entry]),
  )

  // listRoute → 整页表单路由；一个域最多取一条（materialForms 里 deliveryArchive 等均 1:1）
  const formsByListRoute = new Map(designForms.map(form => [form.listRoute, form.route]))
  const context = { navLeaves: appNavLeaves, designPageRoutes, formsByListRoute }

  const screenParity = appRoutes.map((appRoute) => {
    const previous = previousScreens.get(appRoute)
    // 人工登记优先：curated 已给出 designRoute 时不被机械推导覆盖（动态 kind 路由要映射多个设计屏）
    if (previous?.designRoute) {
      return {
        appRoute,
        designRoute: previous.designRoute,
        status: previous.status ?? 'covered',
        ...(previous.reason ? { reason: previous.reason } : {}),
        ...(previous.issue ? { issue: previous.issue } : {}),
      }
    }
    const derived = deriveDesignRoute(appRoute, context)
    if (derived)
      return { appRoute, designRoute: derived, status: 'covered' }
    return {
      appRoute,
      designRoute: null,
      status: previous?.status ?? 'design-pending',
      reason: previous?.reason ?? '',
      ...(previous?.issue ? { issue: previous.issue } : {}),
    }
  })

  const mappedDesignRoutes = new Set(
    screenParity.flatMap(entry => asRoutes(entry.designRoute)),
  )
  const designOnly = [...designPageRoutes]
    .filter(route => !mappedDesignRoutes.has(route))
    .sort()
    .map((designRoute) => {
      const previous = previousDesignOnly.get(designRoute)
      return {
        designRoute,
        status: previous?.status ?? 'retired',
        reason: previous?.reason ?? '',
      }
    })

  const navParity = appNavLeaves.map((leaf) => {
    const designLeaf = design.navLeaves.find(item => item.key === leaf.key)
    return {
      key: leaf.key,
      appNavTo: leaf.to ?? null,
      appLabel: leaf.label,
      designLabel: designLeaf?.label ?? null,
      designPageTitle: design.pages.find(page => page.route === leaf.key)?.title ?? null,
    }
  })

  // 设计稿内部同一 key 的两个名字：NAV 的菜单短名 vs PAGE 的页标题。
  // 「短名 vs 完整名」是正常模式，但必须逐条登记原因；未登记的新分歧会让契约测试变红。
  const previousVariants = new Map(
    (curated.navTitleVariants ?? []).map(entry => [entry.key, entry]),
  )
  const navTitleVariants = navParity
    .filter(entry => entry.designLabel && entry.designPageTitle && entry.designLabel !== entry.designPageTitle)
    .map(entry => ({
      key: entry.key,
      navLabel: entry.designLabel,
      pageTitle: entry.designPageTitle,
      reason: previousVariants.get(entry.key)?.reason ?? '',
    }))

  return {
    $schema: '本文件由 pnpm design:sync-coverage 生成；status 只允许 covered / design-pending / retired。',
    counts: {
      designPageRoutes: designPageRoutes.size,
      designFormRoutes: designForms.length,
      designNavGroups: design.navGroups.length,
      designNavLeaves: design.navLeaves.length,
      designMountedScreens: design.screens.length,
      appPageFiles: appRoutes.length,
      appNavLeaves: appNavLeaves.length,
      covered: screenParity.filter(entry => entry.status === 'covered').length,
      designPending: screenParity.filter(entry => entry.status === 'design-pending').length,
      retired: designOnly.filter(entry => entry.status === 'retired').length,
      navTitleVariants: navTitleVariants.length,
    },
    screenParity,
    designOnly,
    navTitleVariants,
    navParity,
  }
}
