import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { execute, select } from '~/lib/db/connection'
import { logCreate, selectVisibleSql } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export interface ProjectAlias {
  id: string
  projectId: string
  alias: string
  createdAt: string
}

function normalizedAlias(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function rowToAlias(row: Record<string, unknown>): ProjectAlias {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    alias: row.alias as string,
    createdAt: (row.created_at ?? '') as string,
  }
}

export const useProjectAliasStore = defineStore('project-alias', () => {
  const list = shallowRef<ProjectAlias[]>([])

  async function load(): Promise<void> {
    const rows = await select<Record<string, unknown>>(
      selectVisibleSql('project_aliases', 'ORDER BY created_at'),
    )
    list.value = rows.map(rowToAlias)
  }

  async function remember(projectId: string, rawAlias: string): Promise<string | null> {
    const alias = rawAlias.trim()
    const normalized = normalizedAlias(alias)
    if (!projectId || normalized.length < 2)
      return null
    if (!list.value.length)
      await load()
    const existing = list.value.find(item => normalizedAlias(item.alias) === normalized)
    if (existing) {
      if (existing.projectId !== projectId)
        throw new Error(`工地写法“${alias}”已绑定其他项目，请先核对项目归属`)
      return existing.id
    }

    const id = generateId('palias')
    await execute(
      'INSERT INTO project_aliases (id, project_id, alias) VALUES (?, ?, ?)',
      [id, projectId, alias],
    )
    await logCreate(db, 'project_aliases', id)
    await load()
    return id
  }

  return { list: readonly(list), load, remember }
})
