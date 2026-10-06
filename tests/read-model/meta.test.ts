import { describe, expect, it } from 'vitest'
import { hasConsistentOriginReadMeta, hasConsistentReadMeta, isReadMetaDTO } from '~/lib/read-model/meta'
import { createReadMeta, withOriginReadMeta, withReadMeta } from '../../server/utils/read-meta'

const session = { workspaceId: 'proof-workspace', actorId: 'proof-actor', capabilities: ['project:list:read', 'customer:list:read'] }
const asOf = '2026-10-04T08:00:00.000Z'
const input = {
  session,
  schemaVersion: 'project-read-v2',
  operation: 'project:list',
  dataOrigin: 'real' as const,
  asOf,
  sources: [{ key: 'projects', state: 'readable' as const, sourceVersion: 'projects:7', asOf }, { key: 'customers', state: 'readable' as const, sourceVersion: 'customers:12', asOf }],
  coverage: 'complete' as const,
  scope: { search: '乙', status: 'active' },
}
describe('可信读取证据', () => {
  it('组合所有实际参与版本，时点与业务更新时间独立；scope不泄露实际查询', () => {
    const meta = createReadMeta(input)
    expect(meta).toMatchObject({ workspaceId: session.workspaceId, actorId: session.actorId, dataOrigin: 'real', asOf, sources: [{ key: 'customers', sourceVersion: 'customers:12' }, { key: 'projects', sourceVersion: 'projects:7' }], authorizedScope: { coverage: 'complete' } })
    expect(meta.sourceVersion).toMatch(/^read-[0-9a-f]{64}$/)
    expect(meta.authorizedScope.fingerprint).toMatch(/^scope-[0-9a-f]{64}$/)
    expect(meta.authorizedScope.fingerprint).not.toContain('乙')
    const customerChanged = createReadMeta({ ...input, sources: [input.sources[0]!, { ...input.sources[1]!, sourceVersion: 'customers:13' }] })
    expect(customerChanged.sourceVersion).not.toBe(meta.sourceVersion)
    expect(customerChanged.authorizedScope.fingerprint).toBe(meta.authorizedScope.fingerprint)
    const later = createReadMeta({ ...input, asOf: '2026-10-04T08:01:00.000Z' })
    expect(later.asOf).not.toBe(meta.asOf)
    expect(later.sourceVersion).toBe(meta.sourceVersion)
    const limited = createReadMeta({ ...input, session: { ...session, capabilities: ['project:list:read'] }, coverage: 'permission-filtered' })
    expect(limited.authorizedScope.fingerprint).not.toBe(meta.authorizedScope.fingerprint)
  })
  it('失效源不得伪装已读；重复来源、未知schema与串身份时点被拒绝', () => {
    const meta = createReadMeta(input)
    expect(isReadMetaDTO(meta, 'project-read-v2')).toBe(true)
    expect(isReadMetaDTO(meta, 'project-read-v3')).toBe(false)
    expect(() => createReadMeta({ ...input, sources: [...input.sources, input.sources[0]!] })).toThrow('读取证据')
    expect(() => createReadMeta({ ...input, sources: [{ key: 'hidden', state: 'forbidden', sourceVersion: 'secret:5', asOf }] })).toThrow('读取证据')
    const unavailable = createReadMeta({ ...input, coverage: 'unknown', sources: [{ key: 'projects', state: 'unavailable', sourceVersion: null, asOf: null }] })
    expect(unavailable.sourceVersion).toBeNull()
    expect(isReadMetaDTO(unavailable)).toBe(true)
    const page = withReadMeta({ asOf: 'old', sourceVersion: 'old', capabilities: [] }, meta)
    expect(hasConsistentReadMeta(page, 'project-read-v2')).toBe(true)
    expect(hasConsistentReadMeta({ ...page, sourceVersion: 'old' }, 'project-read-v2')).toBe(false)
    const demo = createReadMeta({ ...input, dataOrigin: 'demo', coverage: 'unknown', sources: [{ key: 'demo-projects', state: 'not-requested', sourceVersion: null, asOf: null }] })
    const indexed = withOriginReadMeta({}, { real: meta, demo })
    expect(hasConsistentOriginReadMeta(indexed, 'project-read-v2')).toBe(true)
    expect(() => withOriginReadMeta({}, { real: meta, demo: { ...demo, actorId: 'other' } })).toThrow('身份或时点')
    expect(hasConsistentOriginReadMeta({ ...indexed, originMeta: { real: meta, demo: { ...demo, dataOrigin: 'real' } } }, 'project-read-v2')).toBe(false)
  })
})
