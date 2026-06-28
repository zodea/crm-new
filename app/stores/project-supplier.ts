import { generateId } from '~/lib/util/id'
import { execute, select } from '~/lib/db/connection'

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
  const list = ref<ProjectSupplier[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(`
        SELECT ps.*, p.name as project_name, s.name as supplier_name
        FROM project_suppliers ps
        LEFT JOIN projects p ON ps.project_id = p.id
        LEFT JOIN suppliers s ON ps.supplier_id = s.id
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

  async function add(projectId: string, supplierId: string) {
    const existing = byProjectAndSupplier(projectId, supplierId)
    if (existing) return existing.id

    const id = generateId('ps')
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO project_suppliers (id, project_id, supplier_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'collecting', ?, ?)`,
      [id, projectId, supplierId, now, now],
    )
    await load()
    return id
  }

  async function updateStatus(id: string, status: ProjectSupplierStatus) {
    const now = new Date().toISOString()
    await execute(
      'UPDATE project_suppliers SET status = ?, updated_at = ? WHERE id = ?',
      [status, now, id],
    )
    await load()
  }

  async function remove(id: string) {
    await execute('DELETE FROM project_suppliers WHERE id = ?', [id])
    await load()
  }

  return { list, loading, load, byId, byProjectAndSupplier, byProject, bySupplier, add, updateStatus, remove }
})
