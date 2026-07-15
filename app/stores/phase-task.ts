import type { PhaseTaskData, PhaseTaskStatus } from '~/lib/project/phases'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { execute, select } from '~/lib/db/connection'
import { logCreate, selectVisibleSql, softDelete, withUpdateLog } from '~/lib/db/soft-delete'
import { createDefaultPhaseTasks, normalizePhaseTasks } from '~/lib/project/phases'
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
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(
        selectVisibleSql('phase_tasks', 'ORDER BY project_id, phase_index, task_index'),
      )
      list.value = rows.map(rowToPhaseTask)
    }
    finally {
      loading.value = false
    }
  }

  function byProject(projectId: string): PhaseTask[] {
    return list.value.filter(task => task.projectId === projectId)
  }

  async function insertTask(task: PhaseTaskData): Promise<string> {
    const id = task.id || generateId('phase')
    await execute(
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
    await logCreate(db, 'phase_tasks', id)
    return id
  }

  async function ensureProject(projectId: string) {
    await load()
    if (byProject(projectId).length)
      return
    for (const task of createDefaultPhaseTasks(projectId))
      await insertTask(task)
    await load()
  }

  async function saveProject(projectId: string, draft: readonly PhaseTaskData[]) {
    const normalized = normalizePhaseTasks(projectId, draft)
    const current = byProject(projectId)
    const currentIds = new Set(current.map(task => task.id))
    const keptIds = new Set(normalized.map(task => task.id).filter(Boolean))

    await db.execute('BEGIN')
    try {
      for (const task of current) {
        if (!keptIds.has(task.id))
          await softDelete(db, 'phase_tasks', task.id)
      }
      for (const task of normalized) {
        if (task.id && currentIds.has(task.id)) {
          await withUpdateLog(db, 'phase_tasks', task.id, () => execute(
            `UPDATE phase_tasks
             SET phase_index=?, task_index=?, title=?, description=?, responsible=?, status=?
             WHERE id=?`,
            [task.phaseIndex, task.taskIndex, task.title, task.description, task.responsible, task.status, task.id],
          ))
        }
        else {
          await insertTask(task)
        }
      }
      await db.execute('COMMIT')
    }
    catch (error) {
      await db.execute('ROLLBACK')
      throw error
    }
    await load()
  }

  return {
    list: readonly(list),
    loading: readonly(loading),
    load,
    byProject,
    ensureProject,
    saveProject,
  }
})
