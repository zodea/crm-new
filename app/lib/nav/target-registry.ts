import type {
  EntityRefDTO,
  NavigationIntentDTO,
  NavigationUnavailableReasonDTO,
} from '~/types/read-model'
import { isDataOriginDTO } from '~/types/read-model'

export type NavigationTargetState
  = 'resolved' | 'missing' | 'forbidden' | 'not-connected' | 'unverified-target' | 'error'

export type NavigationTargetResolution
  = {
    state: 'resolved'
    label: string
    to: string
  }
  | {
    state: Exclude<NavigationTargetState, 'resolved'>
    label: string | null
    message: string
  }

interface ResolveNavigationTargetOptions {
  label?: string | null
}

type ResolvedEntityRef = Extract<EntityRefDTO, { state: 'resolved' }>
type EntityTargetIntent = Extract<NavigationIntentDTO, { kind: 'entity-detail' }>
  & { subject: ResolvedEntityRef }
type TargetBuilder = (intent: EntityTargetIntent) => string

const STATE_MESSAGES: Record<Exclude<NavigationTargetState, 'resolved'>, string> = {
  'missing': '未记录稳定身份',
  'forbidden': '无查看权限',
  'not-connected': '详情待接入',
  'unverified-target': '目标待核验',
  'error': '目标解析失败',
}

function entityPath(prefix: string, intent: EntityTargetIntent): string {
  return `${prefix}/${encodeURIComponent(intent.subject.id)}`
}

function projectPath(intent: EntityTargetIntent): string {
  const path = entityPath('/project', intent)
  const dataOrigin = intent.filters.dataOrigin
  if (dataOrigin == null)
    return path
  if (!isDataOriginDTO(dataOrigin))
    throw new Error('invalid project data origin')
  return `${path}?origin=${dataOrigin}`
}

const TARGET_REGISTRY = {
  'project:detail': projectPath,
  'customer:detail': (intent: EntityTargetIntent) => entityPath('/base/customer', intent),
  'supplier:detail': (intent: EntityTargetIntent) => entityPath('/base/supplier', intent),
  'contract:detail': (intent: EntityTargetIntent) => entityPath('/contract', intent),
  'invoice:detail': (intent: EntityTargetIntent) => entityPath('/finance/invoice', intent),
} satisfies Record<string, TargetBuilder>

type RegisteredTargetKey = keyof typeof TARGET_REGISTRY

function unavailable(
  state: Exclude<NavigationTargetState, 'resolved'>,
  label: string | null,
): NavigationTargetResolution {
  return { state, label, message: STATE_MESSAGES[state] }
}

function unavailableReasonState(
  reason: NavigationUnavailableReasonDTO,
): Exclude<NavigationTargetState, 'resolved' | 'error'> {
  if (reason === 'missing-id')
    return 'missing'
  if (reason === 'forbidden')
    return 'forbidden'
  if (reason === 'unverified-target')
    return 'unverified-target'
  return 'not-connected'
}

function hasRegisteredEntity(entity: string): boolean {
  return Object.keys(TARGET_REGISTRY).some(key => key.startsWith(`${entity}:`))
}

export function registeredTargetKeys(): RegisteredTargetKey[] {
  return Object.keys(TARGET_REGISTRY).sort() as RegisteredTargetKey[]
}

export function resolveNavigationTarget(
  intent: NavigationIntentDTO,
  options: ResolveNavigationTargetOptions = {},
): NavigationTargetResolution {
  if (intent.kind === 'unavailable') {
    const state = unavailableReasonState(intent.reason)
    return unavailable(state, state === 'forbidden' ? null : options.label ?? null)
  }
  if (intent.kind === 'entity-list')
    return unavailable('unverified-target', options.label ?? null)

  if (intent.subject.state === 'missing')
    return unavailable('missing', null)
  if (intent.subject.state === 'forbidden')
    return unavailable('forbidden', null)
  if (intent.subject.id.trim() === '')
    return unavailable('missing', intent.subject.label)
  if (intent.kind === 'same-route-overlay')
    return unavailable('unverified-target', intent.subject.label)
  if (intent.kind !== 'entity-detail')
    return unavailable('unverified-target', intent.subject.label)

  const key = `${intent.subject.entity}:${intent.variant ?? ''}`
  const builder = TARGET_REGISTRY[key as RegisteredTargetKey]
  if (!builder) {
    return unavailable(
      hasRegisteredEntity(intent.subject.entity) ? 'unverified-target' : 'not-connected',
      intent.subject.label,
    )
  }

  try {
    return {
      state: 'resolved',
      label: intent.subject.label,
      to: builder(intent as EntityTargetIntent),
    }
  }
  catch {
    return unavailable('error', intent.subject.label)
  }
}
