import type { LookupOption } from '~/lib/kit/lookup'
import { describe, expect, it } from 'vitest'
import { ref } from 'vue'
import {
  highlightMatch,
  lookupRecentStorageKey,
  recentStore,
} from '~/lib/kit/lookup'

describe('lookup keyword highlighting', () => {
  it('marks every case-insensitive match while preserving the original label', () => {
    expect(highlightMatch('Alpha ALPHA 工程', 'alpha')).toEqual([
      { text: 'Alpha', highlighted: true },
      { text: ' ', highlighted: false },
      { text: 'ALPHA', highlighted: true },
      { text: ' 工程', highlighted: false },
    ])
  })

  it('returns one plain segment for an empty or unmatched keyword', () => {
    expect(highlightMatch('车陂项目', '')).toEqual([
      { text: '车陂项目', highlighted: false },
    ])
    expect(highlightMatch('车陂项目', '天河')).toEqual([
      { text: '车陂项目', highlighted: false },
    ])
  })
})

describe('lookup recent selections', () => {
  it('partitions business recents by workspace data origin', () => {
    expect(lookupRecentStorageKey('projects', 'workspace-default', 'real')).toBe(
      'kit-lookup:workspace-default:real:projects:recent',
    )
    expect(lookupRecentStorageKey('projects', 'workspace-default', 'demo')).toBe(
      'kit-lookup:workspace-default:demo:projects:recent',
    )
  })

  it('keeps the five newest unique selections', () => {
    const state = ref<LookupOption[]>([])
    const recents = recentStore(state)

    for (let index = 1; index <= 6; index++) {
      recents.add({
        id: `project-${index}`,
        label: `项目 ${index}`,
      })
    }
    recents.add({
      id: 'project-3',
      label: '项目 3（已更新）',
    })

    expect(recents.getAll()).toEqual([
      { id: 'project-3', label: '项目 3（已更新）' },
      { id: 'project-6', label: '项目 6' },
      { id: 'project-5', label: '项目 5' },
      { id: 'project-4', label: '项目 4' },
      { id: 'project-2', label: '项目 2' },
    ])
  })

  it('clears the configured recent selection list', () => {
    const state = ref<LookupOption[]>([
      { id: 'project-1', label: '项目 1' },
    ])
    const recents = recentStore(state)

    recents.clear()

    expect(recents.getAll()).toEqual([])
  })
})
