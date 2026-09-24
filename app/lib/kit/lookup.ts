import type { Ref } from 'vue'
import type { DataOriginDTO } from '~/types/read-model'
import { computed } from 'vue'

export interface LookupOption {
  id: string
  label: string
  hint?: string
}

export interface HighlightSegment {
  text: string
  highlighted: boolean
}

const RECENT_LIMIT = 5

export function highlightMatch(label: string, keyword: string): HighlightSegment[] {
  const needle = keyword.trim()
  if (!needle)
    return [{ text: label, highlighted: false }]

  const lowerLabel = label.toLocaleLowerCase()
  const lowerNeedle = needle.toLocaleLowerCase()
  const segments: HighlightSegment[] = []
  let cursor = 0

  while (cursor < label.length) {
    const matchIndex = lowerLabel.indexOf(lowerNeedle, cursor)
    if (matchIndex < 0)
      break

    if (matchIndex > cursor) {
      segments.push({
        text: label.slice(cursor, matchIndex),
        highlighted: false,
      })
    }
    segments.push({
      text: label.slice(matchIndex, matchIndex + needle.length),
      highlighted: true,
    })
    cursor = matchIndex + needle.length
  }

  if (cursor < label.length)
    segments.push({ text: label.slice(cursor), highlighted: false })

  return segments.length > 0
    ? segments
    : [{ text: label, highlighted: false }]
}

export function lookupRecentStorageKey(
  key: string,
  workspaceId: string,
  dataOrigin: DataOriginDTO,
) {
  return `kit-lookup:${workspaceId}:${dataOrigin}:${key}:recent`
}

export function recentStore(state: Ref<LookupOption[]>) {
  const items = computed(() => state.value)

  function getAll() {
    return [...state.value]
  }

  function add(option: LookupOption) {
    state.value = [
      option,
      ...state.value.filter(item => item.id !== option.id),
    ].slice(0, RECENT_LIMIT)
  }

  function clear() {
    state.value = []
  }

  return {
    items,
    getAll,
    add,
    clear,
  }
}
