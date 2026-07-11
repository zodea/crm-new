// 合同新增/编辑表单（#90）：三列表与详情页共用同一份字段配置（useKitUI.formModal 驱动）。
// 蓝本：设计稿 EntityListScreen 由列 meta 生成表单——项目/分供方下拉「存 id 显名称」，
// settled/invoiced/paid 为台账聚合口径不入表单（新增默认 0，编辑随行原值回写）。
import type { ContractKind } from '~/lib/contract/status'
import type { FieldDef } from '~/lib/kit/form-modal'
import type { Contract } from '~/stores/contract'
import { CONTRACT_STATUSES, CONTRACT_SUB_KINDS } from '~/lib/contract/status'

const KIND_TITLE: Record<ContractKind, string> = {
  施工: '施工合同',
  分包: '分包合同',
  材采: '材料采购合同',
}

export function useContractForm() {
  const store = useContractStore()
  const projectStore = useProjectStore()
  const supplierStore = useSupplierStore()
  const { formModal, success, error } = useKitUI()

  /**
   * 打开合同表单：row 缺省=新增，传入=编辑（kind 不可改，由页面/详情按 kind 固定）。
   * @returns 是否实际保存
   */
  async function openContractForm(kind: ContractKind, row?: Contract): Promise<boolean> {
    const isExpense = kind !== '施工' // 支出侧（分包/材采）才有乙方
    const fields: FieldDef[] = [
      { key: 'name', label: '合同名称', required: true, full: true, value: row?.name ?? '' },
      { key: 'no', label: '合同编号', value: row?.no ?? '', placeholder: '如 RJ-HHXC-SG-2026001' },
      {
        key: 'projectId',
        label: '项目名称',
        type: 'select',
        required: true,
        options: projectStore.list.map(p => p.name),
        value: row ? projectStore.byId(row.projectId)?.name ?? '' : '',
      },
    ]
    if (isExpense) {
      fields.push({
        key: 'supplierId',
        label: '乙方（分供方）',
        type: 'select',
        required: true,
        options: supplierStore.list.map(s => s.name),
        value: row?.supplierId ? supplierStore.byId(row.supplierId)?.name ?? '' : '',
      })
    }
    if (kind === '分包') {
      fields.push({
        key: 'subKind',
        label: '类别',
        type: 'select',
        required: true,
        options: [...CONTRACT_SUB_KINDS],
        value: row?.subKind || '劳务',
      })
    }
    fields.push(
      { key: 'amount', label: kind === '分包' ? '含税合价' : '含税合同金额', type: 'number', value: row?.amount ?? '' },
      { key: 'changed', label: '变更后合同金额', type: 'number', value: row?.changed ?? '', placeholder: '留空 = 同含税金额' },
      { key: 'signDate', label: '签约日期', type: 'date', value: row?.signDate ?? '' },
      { key: 'status', label: '合同状态', type: 'select', options: [...CONTRACT_STATUSES], value: row?.status ?? '履约中' },
      { key: 'note', label: '备注', type: 'textarea', full: true, value: row?.note ?? '', placeholder: '选填' },
    )

    const values = await formModal({
      title: row ? `编辑 · ${row.name}` : `新增${KIND_TITLE[kind]}`,
      cols: 2,
      width: 640,
      fields,
    })
    if (!values)
      return false

    // 下拉显名称、落库存 id：按名称反查（列表来自 store，名称唯一性由演示数据保证）
    const project = projectStore.list.find(p => p.name === values.projectId)
    const supplier = supplierStore.list.find(s => s.name === values.supplierId)
    const amount = Number(values.amount) || 0
    const changed = values.changed === '' || values.changed == null ? amount : Number(values.changed) || 0
    const patch: Partial<Contract> = {
      no: String(values.no ?? ''),
      name: String(values.name ?? ''),
      subKind: kind === '分包' ? String(values.subKind ?? '') : '',
      projectId: project?.id ?? row?.projectId ?? '',
      supplierId: isExpense ? supplier?.id ?? row?.supplierId ?? null : null,
      amount,
      changed,
      signDate: String(values.signDate ?? ''),
      status: String(values.status ?? '履约中'),
      note: String(values.note ?? ''),
    }

    if (row) {
      const logId = await store.update(row.id, { ...row, ...patch })
      if (!logId) {
        error('保存失败：合同不存在或已被删除')
        return false
      }
      success('已保存')
    }
    else {
      await store.add({ ...patch, kind, settled: 0, invoiced: 0, paid: 0 })
      success(`已新增「${patch.name}」`)
    }
    return true
  }

  return { openContractForm }
}
