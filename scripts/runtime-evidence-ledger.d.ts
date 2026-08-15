export type EvidenceGrade = 'direct' | 'adjacent' | 'historical' | 'unverified-target' | 'local-authority'
export type PermissionStatus = 'read-only-observed' | 'read-only-observed-with-restricted-target' | 'unverified' | 'not-applicable'
export type ObservationDateStatus = 'recorded' | 'not-recorded-historical' | 'not-observed' | 'not-applicable-local-authority'

export interface RuntimeEvidenceEndpoint {
  evidenceRecordId: string
  page: string
  localRoute: string
  domainCode: string
  template: string
  implementationIssues: number[]
  referenceProfile: string
  referenceEndpointId: string
  referenceEndpointLabel: string
  evidenceGrade: EvidenceGrade
  observationDate: string | null
  observationDateStatus: ObservationDateStatus
  permissionStatus: PermissionStatus
  layoutConclusion: { sourceDocument: string, routeKey: string }
  stateAndNavigationConclusion: { sourceDocument: string, routeKey: string }
  constraints: string
}

export interface RuntimeEvidenceLedger {
  $schema: string
  auditedAt: string
  counts: Record<string, number>
  domains: {
    code: string
    domain: string
    routeCount: number
    implementationIssues: number[]
  }[]
  endpoints: RuntimeEvidenceEndpoint[]
}

export declare const RUNTIME_AUDIT_PATH: string
export declare const READ_MODELS_PATH: string
export declare const RUNTIME_EVIDENCE_LEDGER_PATH: string
export declare const IMPLEMENTATION_STATUS_PATH: string
export declare const RUNTIME_SUMMARY_BLOCK_BEGIN: string
export declare const RUNTIME_SUMMARY_BLOCK_END: string
export declare const IMPLEMENTATION_FRONTIER_BLOCK_BEGIN: string
export declare const IMPLEMENTATION_FRONTIER_BLOCK_END: string
export declare function buildRuntimeEvidenceLedger(): RuntimeEvidenceLedger
export declare function renderRuntimeEvidenceSummary(ledger: RuntimeEvidenceLedger): string
export declare function replaceRuntimeEvidenceSummary(source: string, ledger: RuntimeEvidenceLedger): string
export declare function renderImplementationFrontier(ledger: RuntimeEvidenceLedger): string
export declare function replaceImplementationFrontier(source: string, ledger: RuntimeEvidenceLedger): string
