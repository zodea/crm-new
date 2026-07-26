import type { FileRefChanges } from '~/lib/forms/file-refs'
import type { LookupOption } from '~/lib/kit/lookup'
import type {
  MaterialFormDraft,
  MaterialFormKind,
  MaterialFormRecordMap,
  MaterialSaveAction,
} from '~/lib/material/forms'
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { select } from '~/lib/db/connection'
import { selectVisibleSql } from '~/lib/db/soft-delete'
import {
  deleteMaterialForm,
  getMaterialStockSummary,
  getOwnerMaterialSummary,
  listMaterialForms,
  loadMaterialForm,
  restoreMaterialForm,
  saveMaterialForm,
  updateMaterialFormAttachments,
} from '~/lib/material/forms'

type MaterialRecord = MaterialFormRecordMap[MaterialFormKind]
type MaterialLookupTable = 'projects' | 'customers' | 'suppliers' | 'crews'

export const useMaterialStore = defineStore('material', () => {
  const records = shallowRef<Partial<Record<MaterialFormKind, MaterialRecord[]>>>({})
  const loading = shallowRef(false)

  function byId<K extends MaterialFormKind>(
    kind: K,
    id: string,
  ): MaterialFormRecordMap[K] | undefined {
    return records.value[kind]?.find(record => record.id === id) as
      | MaterialFormRecordMap[K]
      | undefined
  }

  async function loadKind<K extends MaterialFormKind>(
    kind: K,
  ): Promise<MaterialFormRecordMap[K][]> {
    loading.value = true
    try {
      const result = await listMaterialForms(kind)
      records.value = {
        ...records.value,
        [kind]: result,
      }
      return result
    }
    finally {
      loading.value = false
    }
  }

  async function loadOne<K extends MaterialFormKind>(
    kind: K,
    id: string,
  ): Promise<MaterialFormRecordMap[K] | null> {
    loading.value = true
    try {
      const record = await loadMaterialForm(kind, id)
      const current = records.value[kind] ?? []
      records.value = {
        ...records.value,
        [kind]: record
          ? [record, ...current.filter(item => item.id !== id)]
          : current.filter(item => item.id !== id),
      }
      return record
    }
    finally {
      loading.value = false
    }
  }

  async function saveForm<K extends MaterialFormKind>(
    kind: K,
    draft: MaterialFormDraft,
    action: MaterialSaveAction,
    attachments: FileRefChanges = {},
  ) {
    loading.value = true
    try {
      const result = await saveMaterialForm(kind, draft, action, attachments)
      await loadOne(kind, result.id)
      if (kind === 'mat_arrival')
        await loadKind('mat_requisition')
      if (kind.startsWith('owner_') && kind !== 'owner_control')
        await loadKind('owner_control')
      return result
    }
    finally {
      loading.value = false
    }
  }

  async function removeForm(kind: MaterialFormKind, id: string) {
    loading.value = true
    try {
      const logId = await deleteMaterialForm(kind, id)
      await loadKind(kind)
      return logId
    }
    finally {
      loading.value = false
    }
  }

  async function saveAttachments(
    kind: MaterialFormKind,
    id: string,
    attachments: FileRefChanges,
  ) {
    loading.value = true
    try {
      return await updateMaterialFormAttachments(kind, id, attachments)
    }
    finally {
      loading.value = false
    }
  }

  async function restoreForm(kind: MaterialFormKind, id: string) {
    loading.value = true
    try {
      const logId = await restoreMaterialForm(kind, id)
      await loadKind(kind)
      return logId
    }
    finally {
      loading.value = false
    }
  }

  async function searchLookup(
    table: MaterialLookupTable,
    keyword: string,
  ): Promise<LookupOption[]> {
    const rows = await select<{ id: string, name: string }>(
      selectVisibleSql(table, 'AND name LIKE ? ORDER BY name LIMIT 50'),
      [`%${keyword.trim()}%`],
    )
    return rows.map(row => ({ id: row.id, label: row.name }))
  }

  const searchProjects = (keyword: string) => searchLookup('projects', keyword)
  const searchCustomers = (keyword: string) => searchLookup('customers', keyword)
  const searchSuppliers = (keyword: string) => searchLookup('suppliers', keyword)
  const searchCrews = (keyword: string) => searchLookup('crews', keyword)

  async function searchContracts(
    projectId: string | null,
    keyword: string,
  ): Promise<LookupOption[]> {
    if (!projectId)
      return []
    const pattern = `%${keyword.trim()}%`
    const rows = await select<{
      id: string
      no: string
      name: string
    }>(selectVisibleSql('contracts', `
      AND kind = '材采'
      AND project_id = ?
      AND (no LIKE ? OR name LIKE ?)
      ORDER BY sign_date DESC, created_at DESC
      LIMIT 50
    `), [projectId, pattern, pattern])
    return rows.map(row => ({
      id: row.id,
      label: row.name,
      hint: row.no || '未编号',
    }))
  }

  async function searchRequisitions(
    projectId: string | null,
    keyword: string,
  ): Promise<LookupOption[]> {
    if (!projectId)
      return []
    const pattern = `%${keyword.trim()}%`
    const rows = await select<{
      id: string
      no: string
      material_name: string
      planned_qty: number
      unit: string
    }>(selectVisibleSql('material_requisitions', `
      AND project_id = ?
      AND (no LIKE ? OR material_name LIKE ?)
      ORDER BY requisition_date DESC, created_at DESC
      LIMIT 50
    `), [projectId, pattern, pattern])
    return rows.map(row => ({
      id: row.id,
      label: `${row.no || '未编号'} · ${row.material_name}`,
      hint: `计划 ${Number(row.planned_qty)} ${row.unit}`,
    }))
  }

  return {
    records: readonly(records),
    loading: readonly(loading),
    byId,
    loadKind,
    loadOne,
    saveForm,
    saveAttachments,
    removeForm,
    restoreForm,
    searchProjects,
    searchCustomers,
    searchSuppliers,
    searchCrews,
    searchContracts,
    searchRequisitions,
    getMaterialStockSummary,
    getOwnerMaterialSummary,
  }
})
