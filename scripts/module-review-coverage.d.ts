export interface CoverageSource { path: string, anchor: string }
export interface CoverageSurface {
  id: string
  route: string
  routePattern: string
  domain: string
  kind: string
  variant: string
  branchIdentity: string
  mode: string
  template: string
  path: string
  label: string
  type: string
  condition: string
  hosts: string[]
  sources: CoverageSource[]
  issueNumbers: number[]
  routeEvidenceId: string
}
export interface CoverageCase {
  id: string
  surfaceId: string
  host: string
  adapter: string
  applicability: string
  sourceState: string
  reference: { status: string, routeEvidenceId: string, note: string }
  acceptance: { rules: string, frontend: string, crossModule: string, production: string }
  reviewEvidence: string[]
  remaining: string[]
}
export interface ModuleReviewCoverage {
  schemaVersion: number
  sourceBaseline: string
  sourceInspectedAt: string
  scope: string
  registry: {
    ownerKinds: { kind: string, scope: string, routeKind: string, sections: string[] }[]
    importEntities: string[]
    boqFormats: string[]
  }
  counts: Record<string, number>
  excludedDevPages: string[]
  adapterProfiles: Record<string, { read: string, write: string, storage: string, sources: CoverageSource[] }>
  referenceMenus: { group: string, label: string, localTargets: string[], issues: number[], mappingStatus: string, note: string, observation: string, date: string, viewport: string, evidence: string }[]
  publicSurfaces: { key: string, label: string, source: CoverageSource, anchor: string, issues: number[], status: string, acceptance: string }[]
  domains: { code: string, label: string, issues: number[], surfaces: number }[]
  surfaces: CoverageSurface[]
  cases: CoverageCase[]
}
export declare const MODULE_REVIEW_COVERAGE_PATH: string
export declare const MODULE_REVIEW_INDEX_PATH: string
export declare function buildModuleReviewCoverage(): ModuleReviewCoverage
export declare function renderModuleReviewIndex(coverage: ModuleReviewCoverage): string
