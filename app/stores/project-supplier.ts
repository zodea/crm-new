import type { TransactionDb } from '~/lib/db/coordinator'
import type { FileRefDraft } from '~/lib/forms/file-refs'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { execute, select, withTransaction } from '~/lib/db/connection'
import { createSoftDeleteActions, hiddenCtes, logCreate, restoreRecord, visibleCond, withUpdateLog } from '~/lib/db/soft-delete'
import { applyFileRefChanges } from '~/lib/forms/file-refs'
import { generateId } from '~/lib/util/id'

export type ProjectSupplierStatus = 'collecting' | 'contracted' | 'claiming' | 'paid' | 'settled'

export interface ProjectSupplier {
  id: string
  projectId: string
  supplierId: string
  status: ProjectSupplierStatus
  reviewerId: string | null
  note: string
  createdAt: string
  updatedAt: string
  projectName?: string
  supplierName?: string
}

export interface ProjectSupplierFileImportGroup {
  supplierId?: string
  supplierName: string
  files: readonly FileRefDraft[]
}

export interface ProjectSupplierFileImportResult {
  relationshipCount: number
  fileCount: number
  createdSupplierCount: number
  reusedRelationshipCount: number
}

function rowToPS(row: Record<string, unknown>): ProjectSupplier {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    supplierId: row.supplier_id as string,
    status: (row.status ?? 'collecting') as ProjectSupplierStatus,
    reviewerId: (row.reviewer_id ?? null) as string | null,
    note: (row.note ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
    projectName: row.project_name as string | undefined,
    supplierName: row.supplier_name as string | undefined,
  }
}

export const useProjectSupplierStore = defineStore('project-supplier', () => {
  const list = shallowRef<ProjectSupplier[]>([])
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(`
        ${hiddenCtes('project_suppliers')}
        SELECT ps.*, p.name as project_name, s.name as supplier_name
        FROM project_suppliers ps
        LEFT JOIN projects p ON ps.project_id = p.id
        LEFT JOIN suppliers s ON ps.supplier_id = s.id
        WHERE ${visibleCond('project_suppliers', 'ps')}
        ORDER BY ps.created_at DESC
      `)
      list.value = rows.map(rowToPS)
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(ps => ps.id === id)
  }

  function byProjectAndSupplier(projectId: string, supplierId: string) {
    return list.value.find(ps => ps.projectId === projectId && ps.supplierId === supplierId)
  }

  function byProject(projectId: string) {
    return list.value.filter(ps => ps.projectId === projectId)
  }

  function bySupplier(supplierId: string) {
    return list.value.filter(ps => ps.supplierId === supplierId)
  }

  /**
   * 添加挂靠。查重查库而非内存列表:同 (project, supplier) 已有可见行直接复用;
   * 只有软删行则恢复原行(避免软删+重加+撤回后出现两条重复挂靠)并重置为
   * collecting(新协作从收集资料开始,不继承上期 settled/paid 状态),都没有才 INSERT。
   */
  async function add(projectId: string, supplierId: string) {
    // 可见行优先于软删行,防止恢复已删老行后与可见行并存
    const [existing] = await select<{ id: string, deleted_at: string | null }>(
      `SELECT id, deleted_at FROM project_suppliers WHERE project_id = ? AND supplier_id = ?
       ORDER BY (deleted_at IS NULL) DESC, created_at LIMIT 1`,
      [projectId, supplierId],
    )
    if (existing) {
      if (existing.deleted_at != null) {
        await restoreRecord(db, 'project_suppliers', existing.id)
        await withUpdateLog(db, 'project_suppliers', existing.id, () => execute(
          'UPDATE project_suppliers SET status = ?, updated_at = ? WHERE id = ?',
          ['collecting', new Date().toISOString(), existing.id],
        ))
        await load()
      }
      return existing.id
    }

    const id = generateId('ps')
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO project_suppliers (id, project_id, supplier_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'collecting', ?, ?)`,
      [id, projectId, supplierId, now, now],
    )
    await logCreate(db, 'project_suppliers', id)
    await load()
    return id
  }

  /** @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败) */
  async function updateStatus(id: string, status: ProjectSupplierStatus) {
    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'project_suppliers', id, () => execute(
      'UPDATE project_suppliers SET status = ?, updated_at = ? WHERE id = ?',
      [status, now, id],
    ))
    await load()
    return logId
  }

  async function ensureImportRelationship(
    tx: TransactionDb,
    projectId: string,
    supplierId: string,
  ): Promise<{ id: string, reused: boolean }> {
    const [existing] = await tx.select<{ id: string, deleted_at: string | null }>(
      `SELECT id, deleted_at FROM project_suppliers WHERE project_id = ? AND supplier_id = ?
       ORDER BY (deleted_at IS NULL) DESC, created_at LIMIT 1`,
      [projectId, supplierId],
    )
    if (existing) {
      if (existing.deleted_at != null) {
        await restoreRecord(tx, 'project_suppliers', existing.id)
        await withUpdateLog(tx, 'project_suppliers', existing.id, () => tx.execute(
          'UPDATE project_suppliers SET status = ?, updated_at = ? WHERE id = ?',
          ['collecting', new Date().toISOString(), existing.id],
        ))
      }
      return { id: existing.id, reused: true }
    }

    const id = generateId('ps')
    const now = new Date().toISOString()
    await tx.execute(
      `INSERT INTO project_suppliers (id, project_id, supplier_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'collecting', ?, ?)`,
      [id, projectId, supplierId, now, now],
    )
    await logCreate(tx, 'project_suppliers', id)
    return { id, reused: false }
  }

  /**
   * 三步向导唯一写路径：新分供方、项目关系与全部附件在同一事务内落库。
   * 任一文件正文或关系写入失败时整体回滚，不留下半成品。
   */
  async function importFiles(
    projectId: string,
    inputGroups: readonly ProjectSupplierFileImportGroup[],
  ): Promise<ProjectSupplierFileImportResult> {
    const groups = new Map<string, ProjectSupplierFileImportGroup>()
    for (const input of inputGroups) {
      const supplierName = input.supplierName.trim()
      const key = input.supplierId || `new:${supplierName.toLocaleLowerCase('zh-CN')}`
      const existing = groups.get(key)
      groups.set(key, {
        supplierId: input.supplierId || existing?.supplierId,
        supplierName: supplierName || existing?.supplierName || '',
        files: [...(existing?.files ?? []), ...input.files],
      })
    }
    if (!groups.size)
      throw new Error('请选择至少一个文件')

    const result = await withTransaction<ProjectSupplierFileImportResult>(async (tx) => {
      let createdSupplierCount = 0
      let reusedRelationshipCount = 0
      let fileCount = 0

      for (const group of groups.values()) {
        let supplierId = group.supplierId?.trim() ?? ''
        if (!supplierId) {
          if (!group.supplierName)
            throw new Error('新分供方名称不能为空')
          supplierId = generateId('sup')
          const now = new Date().toISOString()
          await tx.execute(
            `INSERT INTO suppliers (
              id, name, aliases, supplier_category, credential_status,
              approval_status, source, created_at, updated_at
            ) VALUES (?, ?, '[]', '其他', 'incomplete', 'draft', 'file-import', ?, ?)`,
            [supplierId, group.supplierName, now, now],
          )
          await logCreate(tx, 'suppliers', supplierId)
          createdSupplierCount += 1
        }

        const relationship = await ensureImportRelationship(tx, projectId, supplierId)
        if (relationship.reused)
          reusedRelationshipCount += 1
        const ids = await applyFileRefChanges(tx, 'project_supplier', relationship.id, {
          add: [...group.files],
        })
        fileCount += ids.length
      }

      return {
        relationshipCount: groups.size,
        fileCount,
        createdSupplierCount,
        reusedRelationshipCount,
      }
    })
    await load()
    return result
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'project_suppliers', load)

  return { list: readonly(list), loading: readonly(loading), load, byId, byProjectAndSupplier, byProject, bySupplier, add, updateStatus, importFiles, remove, restore, undo }
})
