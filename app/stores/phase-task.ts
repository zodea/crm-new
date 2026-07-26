import type { SoftDb } from '~/lib/db/soft-delete'
import type { FileRefDraft, FileRefRecord } from '~/lib/forms/file-refs'
import type { PhaseTaskData, PhaseTaskStatus } from '~/lib/project/phases'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { select, withTransaction } from '~/lib/db/connection'
import { logCreate, selectVisibleSql, softDelete, undoOperation, withUpdateLog } from '~/lib/db/soft-delete'
import {
  applyFileRefChanges,
  listFileRefsByOwnerType,
} from '~/lib/forms/file-refs'
import { normalizePhaseTasks, PROJECT_PHASES } from '~/lib/project/phases'
import { generateId } from '~/lib/util/id'

export type PhaseTask = PhaseTaskData

function rowToPhaseTask(row: Record<string, unknown>): PhaseTask {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    phaseIndex: Number(row.phase_index),
    taskIndex: Number(row.task_index),
    title: (row.title ?? '') as string,
    description: (row.description ?? '') as string,
    responsible: (row.responsible ?? '') as string,
    status: (row.status ?? 'pending') as PhaseTaskStatus,
  }
}

export const usePhaseTaskStore = defineStore('phase-task', () => {
  const list = shallowRef<PhaseTask[]>([])
  const files = shallowRef<FileRefRecord[]>([])
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const [rows, fileRows] = await Promise.all([
        select<Record<string, unknown>>(
          selectVisibleSql('phase_tasks', 'ORDER BY project_id, phase_index, task_index'),
        ),
        listFileRefsByOwnerType('phase_task'),
      ])
      const mappedTasks = rows.map(rowToPhaseTask)
      const tasksWithFiles = new Set(fileRows.map(file => file.ownerId))
      list.value = mappedTasks.map(task =>
        task.status === 'uploaded' && !tasksWithFiles.has(task.id)
          ? { ...task, status: 'pending' }
          : task,
      )
      files.value = fileRows
    }
    finally {
      loading.value = false
    }
  }

  function byProject(projectId: string): PhaseTask[] {
    return list.value.filter(task => task.projectId === projectId)
  }

  function filesByTask(taskId: string): FileRefRecord[] {
    return taskId ? files.value.filter(file => file.ownerId === taskId) : []
  }

  async function insertTask(
    tx: SoftDb,
    task: PhaseTaskData,
  ): Promise<{ id: string, logId: string | null }> {
    const id = task.id || generateId('phase')
    await tx.execute(
      `INSERT INTO phase_tasks (id, project_id, phase_index, task_index, title, description, responsible, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        task.projectId,
        task.phaseIndex,
        task.taskIndex,
        task.title,
        task.description,
        task.responsible,
        task.status,
        new Date().toISOString(),
      ],
    )
    return { id, logId: await logCreate(tx, 'phase_tasks', id) }
  }

  async function saveProject(projectId: string, draft: readonly PhaseTaskData[]) {
    const normalized = normalizePhaseTasks(projectId, draft)
    const current = byProject(projectId)
    const currentIds = new Set(current.map(task => task.id))
    const keptIds = new Set(normalized.map(task => task.id).filter(Boolean))
    const logIds: string[] = []

    await withTransaction(async (tx) => {
      for (const task of current) {
        if (!keptIds.has(task.id)) {
          const logId = await softDelete(tx, 'phase_tasks', task.id)
          if (logId)
            logIds.push(logId)
        }
      }
      for (const task of normalized) {
        if (task.id && currentIds.has(task.id)) {
          const logId = await withUpdateLog(tx, 'phase_tasks', task.id, () => tx.execute(
            `UPDATE phase_tasks
             SET phase_index=?, task_index=?, title=?, description=?, responsible=?, status=?
             WHERE id=?`,
            [task.phaseIndex, task.taskIndex, task.title, task.description, task.responsible, task.status, task.id],
          ))
          if (logId)
            logIds.push(logId)
        }
        else {
          const inserted = await insertTask(tx, task)
          if (inserted.logId)
            logIds.push(inserted.logId)
        }
      }
    })
    await load()
    return logIds
  }

  async function undoSave(logIds: readonly string[]) {
    await withTransaction(async (tx) => {
      for (const logId of [...logIds].reverse())
        await undoOperation(tx, logId)
    })
    await load()
  }

  async function addFiles(
    task: PhaseTaskData,
    drafts: FileRefDraft[],
    projectTasks: readonly PhaseTaskData[] = [task],
  ) {
    if (!drafts.length)
      return []
    let taskId = task.id
    await withTransaction(async (tx) => {
      const persisted = taskId
        ? list.value.find(candidate => candidate.id === taskId)
        : undefined
      if (!persisted) {
        const normalized = normalizePhaseTasks(task.projectId, projectTasks)
        const draftsToInsert = byProject(task.projectId).length
          ? [task]
          : normalized
        for (const taskDraft of draftsToInsert) {
          const inserted = await insertTask(tx, taskDraft)
          if (
            taskDraft.phaseIndex === task.phaseIndex
            && taskDraft.taskIndex === task.taskIndex
          ) {
            taskId = inserted.id
          }
        }
      }
      if (!taskId)
        throw new Error('无法确定阶段任务，附件未保存')
      await applyFileRefChanges(tx, 'phase_task', taskId, {
        add: drafts.map(file => ({
          ...file,
          category: file.category || PROJECT_PHASES[task.phaseIndex]?.name || '阶段文件',
        })),
      })
      if (task.status === 'pending') {
        await withUpdateLog(tx, 'phase_tasks', taskId, () => tx.execute(
          `UPDATE phase_tasks SET status = 'uploaded' WHERE id = ?`,
          [taskId],
        ))
      }
    })
    await load()
    return filesByTask(taskId)
  }

  async function removeFile(taskId: string, fileId: string): Promise<string[]> {
    const file = files.value.find(candidate =>
      candidate.id === fileId && candidate.ownerId === taskId,
    )
    if (!file)
      throw new Error('阶段附件不存在或已删除')
    const logIds: string[] = []
    await withTransaction(async (tx) => {
      const fileLogId = await softDelete(tx, 'file_refs', fileId)
      if (fileLogId)
        logIds.push(fileLogId)
      const remaining = await tx.select<{ count: number }>(
        `SELECT COUNT(*) AS count
         FROM file_refs
         WHERE owner_type = 'phase_task'
           AND owner_id = ?
           AND deleted_at IS NULL`,
        [taskId],
      )
      const task = list.value.find(candidate => candidate.id === taskId)
      if (task?.status === 'uploaded' && Number(remaining[0]?.count ?? 0) === 0) {
        const taskLogId = await withUpdateLog(tx, 'phase_tasks', taskId, () => tx.execute(
          `UPDATE phase_tasks SET status = 'pending' WHERE id = ?`,
          [taskId],
        ))
        if (taskLogId)
          logIds.push(taskLogId)
      }
    })
    await load()
    return logIds
  }

  async function undoFileChanges(logIds: readonly string[]) {
    await undoSave(logIds)
  }

  return {
    list: readonly(list),
    files: readonly(files),
    loading: readonly(loading),
    load,
    byProject,
    filesByTask,
    saveProject,
    undoSave,
    addFiles,
    removeFile,
    undoFileChanges,
  }
})
