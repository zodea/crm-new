// scripts/design-coverage.mjs 的类型声明：供 tests/ui/design-token-contract.test.ts 消费。
// 生成脚本本体保持 .mjs（与 sync-design-token-manifest.mjs 一致，无需构建步骤）。

export declare const PROJECT_ROOT: string
export declare const DESIGN_HTML_PATH: string
export declare const DESIGN_FORMS_DIR: string
export declare const NAV_TREE_PATH: string
export declare const PAGES_ROOT: string
export declare const COVERAGE_PATH: string
export declare const STATUS_DOC_PATH: string
export declare const COVERAGE_BLOCK_BEGIN: string
export declare const COVERAGE_BLOCK_END: string
export declare const COVERAGE_STATUSES: readonly string[]

export declare function renderCountsBlock(counts: Record<string, number>): string
export declare function readCountsBlock(docPath?: string): string
export declare function replaceCountsBlock(source: string, counts: Record<string, number>): string

export interface DesignPage {
  route: string
  title: string
  subtitle: string
}

export interface DesignRegistry {
  pages: DesignPage[]
  navGroups: { key: string, label: string }[]
  navLeaves: { key: string, label: string }[]
  screens: { global: string, file: string }[]
  stylesheets: string[]
  externalScripts: string[]
}

export interface DesignFormRoute {
  route: string
  title: string
  listRoute: string
  definedIn: string
}

export interface AppNavLeaf {
  key: string
  label: string
  to?: string
}

export interface CoverageEntry {
  appRoute: string
  designRoute: string | string[] | null
  status: string
  reason?: string
  issue?: number
}

export interface Coverage {
  $schema: string
  counts: Record<string, number>
  screenParity: CoverageEntry[]
  designOnly: { designRoute: string, status: string, reason: string }[]
  navTitleVariants: { key: string, navLabel: string, pageTitle: string, reason: string }[]
  navParity: {
    key: string
    appNavTo: string | null
    appLabel: string
    designLabel: string | null
    designPageTitle: string | null
  }[]
}

export declare function asRoutes(designRoute: string | string[] | null | undefined): string[]
export declare function readDesignRegistry(htmlPath?: string): DesignRegistry
export declare function readDesignFormRoutes(formsDir?: string): DesignFormRoute[]
export declare function readAppNavLeaves(navTreePath?: string): AppNavLeaf[]
export declare function readAppNavGroups(navTreePath?: string): { key: string, label: string }[]
export declare function pageFileToRoute(relativePath: string): string
export declare function readAppRoutes(pagesRoot?: string): string[]
export declare function deriveDesignRoute(
  appRoute: string,
  context: {
    navLeaves: AppNavLeaf[]
    designPageRoutes: Set<string>
    formsByListRoute: Map<string, string>
  },
): string | null
export declare function buildCoverage(curated?: Partial<Coverage>): Coverage
