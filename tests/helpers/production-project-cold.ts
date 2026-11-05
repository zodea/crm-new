import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { createProductionProjectService } from '../../server/utils/production-project-service'
import { createProductionStorage } from '../../server/utils/production-storage'

function isInside(parent: string, path: string): boolean {
  const child = relative(parent, path)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function main() {
  const [rootArg, directoryArg, zeroId, unknownId] = process.argv.slice(2)
  if (!rootArg || !directoryArg || !zeroId || !unknownId || zeroId === unknownId)
    throw new Error('project cold process requires a task-owned directory and two distinct project IDs')
  const taskRoot = resolve(rootArg)
  const directory = resolve(directoryArg)
  const tempRoot = resolve('.tmp')
  if (!isAbsolute(rootArg) || !isAbsolute(directoryArg) || !isInside(tempRoot, taskRoot) || !isInside(taskRoot, directory))
    throw new Error('project cold process requires an isolated directory inside its test root')
  for (const path of [tempRoot, taskRoot, directory]) {
    const stat = await lstat(path)
    if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(path)).toLowerCase() !== path.toLowerCase())
      throw new Error('project cold process directory cannot use links')
  }
  const storage = createProductionStorage({ directory, workspaceId: 'project-workspace', ownerId: 'project-owner', purpose: 'verification' })
  const actor = { workspaceId: 'project-workspace', actorId: 'project-owner', capabilities: ['project:list:read', 'project:write', 'customer:list:read'] }
  const service = createProductionProjectService(storage)
  try {
    const page = await service.list({}, () => actor)
    const zero = await service.form(zeroId, () => actor)
    const unknown = await service.form(unknownId, () => actor)
    const restricted = await service.list({}, () => ({ ...actor, capabilities: ['project:list:read'] }))
    let denied: unknown = 'unexpected-success'
    try {
      await service.list({}, () => ({ ...actor, capabilities: [] }))
    }
    catch (cause) {
      if (!cause || typeof cause !== 'object' || !('problem' in cause))
        throw cause
      denied = cause.problem
    }
    process.stdout.write(JSON.stringify({
      pid: process.pid,
      items: page.items.map(item => ({ project: item.project, contractAmount: item.contractAmount, dataOrigin: item.dataOrigin })),
      zero: { id: zero.draft.id, version: zero.version, amount: zero.draft.contractAmount },
      unknown: { id: unknown.draft.id, version: unknown.version, amount: unknown.draft.contractAmount },
      restricted: restricted.items,
      denied,
    }))
  }
  finally { await storage.close() }
}

void main().catch((cause) => {
  process.stderr.write(String(cause))
  process.exitCode = 1
})
