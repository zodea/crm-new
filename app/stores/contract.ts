import type { ContractKind } from '~/lib/contract/status'
// 合同域 store(#90 批A):施工/分包/材采单表 kind 区分,唯一写路径 action。
// 显式 import pinia/vue(不靠 Nuxt auto-import):tests/stores/contract.test.ts 在 node 直测本模块。
import { defineStore } from 'pinia'
import { readonly, shallowRef } from 'vue'
import { db } from '~/lib/db/client'
import { execute, select } from '~/lib/db/connection'
import { createSoftDeleteActions, logCreate, selectVisibleSql, withUpdateLog } from '~/lib/db/soft-delete'
import { generateId } from '~/lib/util/id'

export interface Contract {
  id: string
  no: string
  name: string
  kind: ContractKind
  /** 劳务|专业,仅 kind=分包 */
  subKind: string
  projectId: string
  /** 施工合同(乙方=我方)为 null */
  supplierId: string | null
  /** 含税合同金额 */
  amount: number
  /** 变更后合同金额 */
  changed: number
  /** 累计结算 */
  settled: number
  /** 累计收票(施工=累计开票) */
  invoiced: number
  /** 累计支付(施工=累计收款) */
  paid: number
  signDate: string
  status: string
  note: string
  createdAt: string
  updatedAt: string
}

/** 金额字段归一:空串 / NaN / nullish → 0(四级金额链默认 0,与 schema DEFAULT 0 一致) */
function toMoney(v: unknown): number {
  if (v === '' || v == null)
    return 0
  const n = Number(v)
  return Number.isNaN(n) ? 0 : n
}

function rowToContract(row: Record<string, unknown>): Contract {
  return {
    id: row.id as string,
    no: (row.no ?? '') as string,
    name: row.name as string,
    kind: (row.kind ?? '施工') as ContractKind,
    subKind: (row.sub_kind ?? '') as string,
    projectId: (row.project_id ?? '') as string,
    supplierId: (row.supplier_id ?? null) as string | null,
    amount: toMoney(row.amount),
    changed: toMoney(row.changed),
    settled: toMoney(row.settled),
    invoiced: toMoney(row.invoiced),
    paid: toMoney(row.paid),
    signDate: (row.sign_date ?? '') as string,
    status: (row.status ?? '履约中') as string,
    note: (row.note ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
  }
}

export const useContractStore = defineStore('contract', () => {
  const list = shallowRef<Contract[]>([])
  const loading = shallowRef(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>(
        selectVisibleSql('contracts', 'ORDER BY created_at DESC'),
      )
      list.value = rows.map(rowToContract)
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(c => c.id === id)
  }

  /** kind 切片(三列表/项目详情子表共用):施工 | 分包 | 材采 */
  function byKind(kind: ContractKind) {
    return list.value.filter(c => c.kind === kind)
  }

  async function add(data: Partial<Contract>) {
    const id = generateId('con')
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO contracts (id, no, name, kind, sub_kind, project_id, supplier_id, amount, changed, settled, invoiced, paid, sign_date, status, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.no ?? '',
        data.name ?? '',
        data.kind ?? '施工',
        data.subKind ?? '',
        data.projectId ?? '',
        data.supplierId ?? null,
        toMoney(data.amount),
        toMoney(data.changed),
        toMoney(data.settled),
        toMoney(data.invoiced),
        toMoney(data.paid),
        data.signDate ?? '',
        data.status ?? '履约中',
        data.note ?? '',
        now,
        now,
      ],
    )
    await logCreate(db, 'contracts', id)
    await load()
    return id
  }

  /**
   * 编辑(kind 不可改,页面按 kind 分栏):调用方传合并后的完整行({...row, ...表单值}),
   * settled/invoiced/paid 不入表单、随行原值回写。
   * @returns 操作日志 id;记录不存在/已删时不写入并返回 null(调用方据此提示失败)
   */
  async function update(id: string, data: Partial<Contract>) {
    const now = new Date().toISOString()
    const logId = await withUpdateLog(db, 'contracts', id, () => execute(
      `UPDATE contracts SET no=?, name=?, sub_kind=?, project_id=?, supplier_id=?, amount=?, changed=?, settled=?, invoiced=?, paid=?, sign_date=?, status=?, note=?, updated_at=? WHERE id=?`,
      [
        data.no ?? '',
        data.name ?? '',
        data.subKind ?? '',
        data.projectId ?? '',
        data.supplierId ?? null,
        toMoney(data.amount),
        toMoney(data.changed),
        toMoney(data.settled),
        toMoney(data.invoiced),
        toMoney(data.paid),
        data.signDate ?? '',
        data.status ?? '履约中',
        data.note ?? '',
        now,
        id,
      ],
    ))
    await load()
    return logId
  }

  const { remove, restore, undo } = createSoftDeleteActions(db, 'contracts', load)

  return { list: readonly(list), loading: readonly(loading), load, byId, byKind, add, update, remove, restore, undo }
})
