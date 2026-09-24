import type { ProjectListNavigationState } from '~/lib/nav/return-to'
import {
  createProjectReturnOrigin,
  isProjectReturnContextId,
  loadProjectReturnOrigin,
  newProjectReturnContextId,
  projectListNavigationStateFromQuery,
  resolveProjectReturnContext,
  saveProjectReturnOrigin,
} from '~/lib/nav/return-to'

interface UseProjectListReturnContextOptions {
  readState: () => ProjectListNavigationState
  applyState: (state: ProjectListNavigationState) => void
  fallbackFocus?: () => HTMLElement | null
}

interface RestoreProjectListReturnContextOptions {
  allowFallback?: boolean
}

function routeQueryValue(value: unknown): string | undefined {
  if (typeof value === 'string')
    return value
  if (Array.isArray(value) && typeof value[0] === 'string')
    return value[0]
  return undefined
}

export function useProjectListReturnContext(options: UseProjectListReturnContextOptions) {
  const route = useRoute()
  const routeContextId = routeQueryValue(route.query.nav)
  const contextId = isProjectReturnContextId(routeContextId)
    ? routeContextId
    : newProjectReturnContextId()
  let restoredRoute = ''

  function anchorId(rowIdentity: string): string {
    return `project-row-${rowIdentity}`
  }

  function originFor(rowIdentity: string, scrollTop: number) {
    return createProjectReturnOrigin({
      contextId,
      anchorId: anchorId(rowIdentity),
      scrollTop,
      now: Date.now(),
      state: options.readState(),
    })
  }

  function returnToFor(rowIdentity: string): string {
    return originFor(rowIdentity, 0).returnTo
  }

  function capture(rowIdentity: string) {
    const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
    saveProjectReturnOrigin(originFor(rowIdentity, workspace?.scrollTop ?? 0))
  }

  function applyRouteState() {
    if (route.path !== '/project')
      return
    options.applyState(projectListNavigationStateFromQuery(route.query))
  }

  async function restore(restoreOptions: RestoreProjectListReturnContextOptions = {}) {
    if (route.path !== '/project' || restoredRoute === route.fullPath)
      return false
    const nav = routeQueryValue(route.query.nav)
    const resolved = resolveProjectReturnContext({
      returnTo: route.fullPath,
      contextId: nav,
      now: Date.now(),
      load: id => loadProjectReturnOrigin(id),
    })
    if (!resolved.origin)
      return false

    await nextTick()
    const anchor = document.getElementById(resolved.origin.anchorId)
    const focusTarget = anchor?.querySelector<HTMLElement>('a, button, [tabindex]')
      ?? (restoreOptions.allowFallback ? options.fallbackFocus?.() : null)
    if (!focusTarget)
      return false

    const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
    if (workspace)
      workspace.scrollTop = resolved.origin.scrollTop
    focusTarget.focus({ preventScroll: true })
    restoredRoute = route.fullPath
    return true
  }

  applyRouteState()
  onActivated(() => {
    applyRouteState()
    void restore()
  })

  return {
    contextId,
    anchorId,
    returnToFor,
    capture,
    restore,
  }
}
