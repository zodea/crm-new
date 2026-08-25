import type { OwnerDocumentDraft } from './forms'

interface CommandIntent {
  commandId: string
  fingerprint: string
}

const intents = new WeakMap<OwnerDocumentDraft, CommandIntent>()

function normalized(value: unknown): unknown {
  if (Array.isArray(value))
    return value.map(normalized)
  if (!value || typeof value !== 'object')
    return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !key.startsWith('_central'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalized(entry)]),
  )
}

export function ownerDocumentCommandId(
  draft: OwnerDocumentDraft,
  payload: Record<string, unknown>,
  createId: () => string = () => `owner-document-${crypto.randomUUID()}`,
): string {
  const fingerprint = JSON.stringify(normalized(payload))
  const current = intents.get(draft)
  if (current?.fingerprint === fingerprint)
    return current.commandId
  const commandId = createId()
  intents.set(draft, { commandId, fingerprint })
  return commandId
}

export function completeOwnerDocumentCommandIntent(draft: OwnerDocumentDraft, commandId: string): void {
  if (intents.get(draft)?.commandId === commandId)
    intents.delete(draft)
}
