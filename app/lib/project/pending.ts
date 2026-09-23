import type { ProjectCommandContextDTO } from './command-contract'
import { projectProblem, ProjectRepositoryProblem } from './repository'

/** Only a scoped command key is retained. Project fields and original bytes never enter browser storage. */
export function projectPendingKey(context: ProjectCommandContextDTO, target: string) {
  return `crm:project-command:v1:${encodeURIComponent(context.workspaceId)}:${encodeURIComponent(context.actorId)}:${encodeURIComponent(target)}`
}
function unavailable(): never {
  throw new ProjectRepositoryProblem(projectProblem('unavailable', '无法可靠保留原提交编号，请保留输入，恢复浏览器存储后重试。'))
}
export function readProjectPending(key: string): string | null {
  try {
    const value = window.sessionStorage.getItem(key)
    if (value !== null && !/^[a-z0-9][\w-]{2,79}$/i.test(value))
      return unavailable()
    return value
  }
  catch { return unavailable() }
}
export function rememberProjectPending(key: string, commandId: string) {
  if (readProjectPending(key))
    throw new ProjectRepositoryProblem(projectProblem('conflict', '请先核对上次提交，再保存新的内容。'))
  try {
    window.sessionStorage.setItem(key, commandId)
    if (readProjectPending(key) !== commandId)
      unavailable()
  }
  catch { unavailable() }
}
export function clearProjectPending(key: string, commandId: string) {
  if (readProjectPending(key) !== commandId)
    throw new ProjectRepositoryProblem(projectProblem('conflict', '原提交编号已经变化，请重新核对。'))
  try {
    window.sessionStorage.removeItem(key)
    if (readProjectPending(key) !== null)
      unavailable()
  }
  catch { unavailable() }
}
