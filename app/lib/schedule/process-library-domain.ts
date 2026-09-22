import type { ScheduleProcessLibraryTaskDraft, ScheduleProcessLibraryVersionDraft } from './process-library'

function requiredText(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized)
    throw new Error(`${label}必填`)
  return normalized
}

/** 库定义只存跨项目可复用的 code；项目身份在建组时再解析。 */
export function normalizeProcessLibraryDraft(draft: ScheduleProcessLibraryVersionDraft): ScheduleProcessLibraryVersionDraft {
  const code = requiredText(draft.code, '工序库编码')
  const name = requiredText(draft.name, '工序库名称')
  if (!draft.tasks.length)
    throw new Error('标准工序库至少需要一道工序')
  const keys = new Set<string>()
  const tasks = draft.tasks.map((task, index): ScheduleProcessLibraryTaskDraft => {
    const key = requiredText(task.key, `第 ${index + 1} 道工序编码`)
    if (keys.has(key))
      throw new Error(`工序编码重复：${key}`)
    const durationDays = Math.trunc(task.durationDays)
    if (!Number.isFinite(durationDays) || durationDays < 1 || durationDays > 365)
      throw new Error(`工序「${task.name || key}」工期必须为 1 到 365 天`)
    keys.add(key)
    return {
      key,
      name: requiredText(task.name, `第 ${index + 1} 道工序名称`),
      trade: task.trade.trim(),
      color: task.color.trim() || '#64748b',
      durationDays,
      stageCode: task.stageCode?.trim() ?? '',
      itemCodes: [...new Set(task.itemCodes.map(value => value.trim()).filter(Boolean))],
      predecessorKey: task.predecessorKey?.trim() || null,
      predecessorDisabled: Boolean(task.predecessorKey && task.predecessorDisabled),
    }
  })
  const indexByKey = new Map(tasks.map((task, index) => [task.key, index]))
  for (const [index, task] of tasks.entries()) {
    if (!task.predecessorKey)
      continue
    const predecessorIndex = indexByKey.get(task.predecessorKey)
    if (predecessorIndex === undefined)
      throw new Error(`工序「${task.name}」的前置工序不存在`)
    if (predecessorIndex === index)
      throw new Error(`工序「${task.name}」不能以前置关系引用自身`)
    if (predecessorIndex > index && !task.predecessorDisabled)
      throw new Error(`工序「${task.name}」的前置工序必须排在当前工序之前`)
    const visited = new Set([task.key])
    let next: string | null = task.predecessorKey
    while (next) {
      if (visited.has(next))
        throw new Error('工序前置关系不能形成循环')
      visited.add(next)
      const nextIndex = indexByKey.get(next)
      next = nextIndex === undefined ? null : tasks[nextIndex]!.predecessorKey
    }
  }
  return { sourceLibraryId: draft.sourceLibraryId, code, name, description: draft.description.trim(), tasks }
}
