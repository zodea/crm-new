import type { ProjectListQueryDTO } from '~/lib/project/repository'
import { describe, expect, it } from 'vitest'
import { projectListViewRow } from '~/lib/project/list'
import { buildProjectListPage } from '~/lib/project/repository'
import { createDemoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'
import {
  createProjectReadTestInstance,
  PROJECT_READ_FIXTURE,
} from '../../server/utils/project-read-test-instance'

const QUERY = {
  search: '',
  status: null,
  filters: {
    statuses: [],
    plannedEnds: [],
    managers: [],
    customerIds: [],
  },
  sort: 'updated-desc',
  page: 1,
  pageSize: 10,
  includeDemo: false,
} as ProjectListQueryDTO & { includeDemo: boolean }

describe('project data-origin boundary', () => {
  it('hides demo rows by default and never merges same-name real/demo identities', () => {
    const source = PROJECT_READ_FIXTURE[0]!
    const rows = [
      { ...source, id: 'project-real-1', dataOrigin: 'real' as const },
      { ...source, id: 'project-demo-1', dataOrigin: 'demo' as const },
    ]

    const productionOnly = buildProjectListPage({
      rows,
      query: QUERY,
      asOf: '2026-08-15T00:00:00.000Z',
      sourceVersion: 'origin-v1',
    })
    expect(productionOnly.items.map(item => item.project.id)).toEqual(['project-real-1'])
    expect(productionOnly.items[0]?.dataOrigin).toBe('real')
    expect(productionOnly.summary.origins.real.projectCount).toBe(1)
    expect(productionOnly.summary.origins.demo.projectCount).toBe(0)

    const withDemo = buildProjectListPage({
      rows,
      query: { ...QUERY, includeDemo: true },
      asOf: '2026-08-15T00:00:00.000Z',
      sourceVersion: 'origin-v1',
    })
    expect(withDemo.items.map(item => item.project.id).sort()).toEqual([
      'project-demo-1',
      'project-real-1',
    ])
    expect(withDemo.items.map(item => item.dataOrigin).sort()).toEqual(['demo', 'real'])
    expect(withDemo.summary.origins.real.projectCount).toBe(1)
    expect(withDemo.summary.origins.demo.projectCount).toBe(1)
  })

  it('requires a server capability before including demo rows', async () => {
    const demoWorkspace = createDemoWorkspaceTestInstance()
    demoWorkspace.reset('forbidden', 'no-demo-capability')
    const instance = createProjectReadTestInstance(sessionId => demoWorkspace.capabilities(sessionId))

    await expect(instance.list(
      { includeDemo: 'true' },
      'no-demo-capability',
    )).rejects.toMatchObject({
      problem: { code: 'forbidden' },
    })
  })

  it('uses dataOrigin and id as the stable cross-source pagination tie-breaker', () => {
    const source = PROJECT_READ_FIXTURE[0]!
    const page = buildProjectListPage({
      rows: [
        { ...source, id: 'same-id', dataOrigin: 'real' },
        { ...source, id: 'same-id', dataOrigin: 'demo' },
      ],
      query: { ...QUERY, includeDemo: true },
      asOf: '2026-08-15T00:00:00.000Z',
      sourceVersion: 'origin-v1',
    })

    expect(page.items.map(item => `${item.dataOrigin}:${item.project.id}`)).toEqual([
      'demo:same-id',
      'real:same-id',
    ])
    expect(page.items.map(projectListViewRow).map(item => item.rowIdentity)).toEqual([
      'demo:same-id',
      'real:same-id',
    ])
  })
})
