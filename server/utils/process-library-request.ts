import type { ProcessLibraryCreateCommand } from '../../app/lib/schedule/process-library-contract'
import { processLibraryProblem } from '../../app/lib/schedule/process-library-contract'

function invalid(): never {
  throw processLibraryProblem('validation-failed', '工序库命令或字段格式无效，请重新核对')
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    invalid()
  return value as Record<string, unknown>
}
function text(value: unknown, required = false): string {
  if (typeof value !== 'string' || (required && !value.trim()))
    invalid()
  return value
}

export function parseProcessLibraryCommand(value: unknown): ProcessLibraryCreateCommand {
  const input = object(value, ['action', 'commandId', 'workspaceId', 'actorId', 'origin', 'requiredCapability', 'baseVersion', 'sourceVersion', 'draft'])
  if (input.action !== 'create-version' || input.requiredCapability !== 'process-library:write'
    || !['real', 'demo'].includes(String(input.origin)) || typeof input.baseVersion !== 'number' || !Number.isSafeInteger(input.baseVersion) || input.baseVersion < 0) {
    invalid()
  }
  const draft = object(input.draft, ['sourceLibraryId', 'code', 'name', 'description', 'tasks'])
  if (!Array.isArray(draft.tasks))
    invalid()
  return {
    action: 'create-version',
    commandId: text(input.commandId, true),
    workspaceId: text(input.workspaceId, true),
    actorId: text(input.actorId, true),
    origin: input.origin as 'real' | 'demo',
    requiredCapability: 'process-library:write',
    baseVersion: input.baseVersion,
    sourceVersion: input.sourceVersion === null ? null : text(input.sourceVersion, true),
    draft: {
      sourceLibraryId: draft.sourceLibraryId === null ? null : text(draft.sourceLibraryId, true),
      code: text(draft.code, true),
      name: text(draft.name, true),
      description: text(draft.description),
      tasks: draft.tasks.map((value) => {
        const task = object(value, ['key', 'name', 'durationDays', 'trade', 'color', 'stageCode', 'itemCodes', 'predecessorKey', 'predecessorDisabled'])
        if (typeof task.durationDays !== 'number' || !Number.isSafeInteger(task.durationDays)
          || !Array.isArray(task.itemCodes) || task.itemCodes.some(code => typeof code !== 'string')
          || (task.predecessorDisabled !== undefined && typeof task.predecessorDisabled !== 'boolean')) {
          invalid()
        }
        return {
          key: text(task.key, true),
          name: text(task.name, true),
          durationDays: task.durationDays,
          trade: text(task.trade),
          color: text(task.color),
          stageCode: text(task.stageCode),
          itemCodes: task.itemCodes as string[],
          predecessorKey: task.predecessorKey === null ? null : text(task.predecessorKey, true),
          predecessorDisabled: task.predecessorDisabled === true,
        }
      }),
    },
  }
}
