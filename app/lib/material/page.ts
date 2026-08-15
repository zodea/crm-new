import type {
  MaterialArrivalLineDraft,
  MaterialFormKind,
  StockCheckLineDraft,
} from '~/lib/material/forms'

export interface MaterialGridLine extends MaterialArrivalLineDraft, StockCheckLineDraft {}

export interface MaterialPageDraft {
  [key: string]: unknown
  id?: string
  no?: string
  status?: string
  note?: string
  projectId?: string | null
  customerId?: string | null
  supplierId?: string | null
  contractId?: string | null
  requisitionId?: string | null
  crewId?: string | null
  applicant?: string
  requisitionDate?: string
  applicationDate?: string
  requiredDate?: string
  arrivalDate?: string
  useDate?: string
  checkDate?: string
  transactionDate?: string
  warehouse?: string
  receiver?: string
  checker?: string
  materialName?: string
  spec?: string
  unit?: string
  plannedQty?: number | null
  controlQty?: number | null
  qty?: number | null
  qualityResult?: string
  stockStatus?: string
  purpose?: string
  useLocation?: string
  arrivedQty?: number
  usedQty?: number
  remainingQty?: number
  stockQty?: number
  totalQty?: number
  totalAmount?: number
  itemCount?: number
  varianceQty?: number
  varianceAmount?: number
  lines?: MaterialGridLine[]
}

export interface MaterialFormMeta {
  label: string
  subtitle: string
  listPath: string
  postLabel: string
  postMessage: string
  sections: Array<{ key: string, label: string }>
}

export const MATERIAL_FORM_META: Record<MaterialFormKind, MaterialFormMeta> = {
  mat_requisition: {
    label: '下料单',
    subtitle: '乙供材要料计划 · 已到量与剩余量由到货事实派生',
    listPath: '/material/requisition',
    postLabel: '保存并提交',
    postMessage: '提交后下料计划不可直接修改，后续到货会自动回写已到量与剩余量。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'material', label: '材料与计划' },
      { key: 'attachments', label: '计划附件' },
    ],
  },
  mat_arrival: {
    label: '材料到货',
    subtitle: '乙供材入库事实 · 数量和金额从明细行聚合',
    listPath: '/material/arrival',
    postLabel: '保存并入库',
    postMessage: '入库后到货明细进入库存与下料单累计到货量，且不可直接修改。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'lines', label: '到货明细' },
      { key: 'quality', label: '质检信息' },
      { key: 'attachments', label: '送货单附件' },
    ],
  },
  mat_use: {
    label: '材料领用',
    subtitle: '乙供材出库事实 · 过账前校验实时可用库存',
    listPath: '/material/use',
    postLabel: '保存并出库',
    postMessage: '出库后领用数量立即计入库存扣减，且不可直接修改。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'material', label: '材料与领用' },
      { key: 'attachments', label: '领料单附件' },
    ],
  },
  stock_check: {
    label: '库存盘点',
    subtitle: '账面量实时读取 · 仅已生效盘点差影响库存',
    listPath: '/material/stock-check',
    postLabel: '保存并生效',
    postMessage: '生效前会再次核对账面量；盘盈盘亏将立即进入库存派生值。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'lines', label: '盘点明细' },
      { key: 'attachments', label: '盘点附件' },
    ],
  },
  owner_control: {
    label: '甲供材总控量',
    subtitle: '总控、到货、领用三量对账 · 累计值不可手工修改',
    listPath: '/owner-material/control',
    postLabel: '保存并生效',
    postMessage: '生效后成为该项目材料的总控基准，后续到货、领用和直入直出均受其约束。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'material', label: '控制量' },
      { key: 'note', label: '备注' },
    ],
  },
  owner_requisition: {
    label: '甲供材下料单',
    subtitle: '向甲方要料 · 项目与材料计划',
    listPath: '/owner-material/requisition',
    postLabel: '保存并提交',
    postMessage: '提交后形成甲供材要料计划，且不可直接修改。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'material', label: '材料与计划' },
      { key: 'attachments', label: '计划附件' },
    ],
  },
  owner_arrival: {
    label: '甲供材到货',
    subtitle: '甲供入库 · 到货量不得超过总控量',
    listPath: '/owner-material/arrival',
    postLabel: '保存并入库',
    postMessage: '入库后数量计入甲供材累计到货与库存，且不可直接修改。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'material', label: '材料与质检' },
      { key: 'attachments', label: '送货单附件' },
    ],
  },
  owner_use: {
    label: '甲供材领用',
    subtitle: '甲供出库 · 同时校验库存与总控余量',
    listPath: '/owner-material/use',
    postLabel: '保存并出库',
    postMessage: '出库后数量计入甲供材累计领用并扣减库存，且不可直接修改。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'material', label: '材料与领用' },
      { key: 'note', label: '备注' },
    ],
  },
  owner_direct: {
    label: '甲供材直入直出',
    subtitle: '不入库直供直用 · 到货与领用同时留事实',
    listPath: '/owner-material/direct',
    postLabel: '保存并确认',
    postMessage: '确认后数量同时计入累计到货与累计领用，但不进入仓库库存。',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'material', label: '材料与去向' },
      { key: 'attachments', label: '签收附件' },
    ],
  },
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function materialFormDefaults(kind: MaterialFormKind): MaterialPageDraft {
  const common = {
    projectId: null,
    status: 'draft',
    note: '',
  }
  switch (kind) {
    case 'mat_requisition':
      return {
        ...common,
        contractId: null,
        requisitionDate: today(),
        plannedQty: 0,
        warehouse: '中心仓',
      }
    case 'mat_arrival':
      return {
        ...common,
        supplierId: null,
        contractId: null,
        requisitionId: null,
        warehouse: '中心仓',
        arrivalDate: today(),
        qualityResult: '合格',
        stockStatus: 'pending',
        lines: [{ materialName: '', spec: '', unit: '', qty: 0, unitPrice: null }],
      }
    case 'mat_use':
      return {
        ...common,
        warehouse: '中心仓',
        useDate: today(),
        crewId: null,
        qty: 0,
      }
    case 'stock_check':
      return {
        ...common,
        warehouse: '中心仓',
        checkDate: today(),
        lines: [{ materialName: '', spec: '', unit: '', bookQty: 0, actualQty: 0, varianceAmount: 0 }],
      }
    case 'owner_control':
      return {
        ...common,
        customerId: null,
        controlQty: 0,
      }
    case 'owner_requisition':
      return {
        ...common,
        applicationDate: today(),
        plannedQty: 0,
      }
    case 'owner_arrival':
      return {
        ...common,
        warehouse: '中心仓',
        arrivalDate: today(),
        qty: 0,
        qualityResult: '合格',
        stockStatus: 'pending',
      }
    case 'owner_use':
      return {
        ...common,
        useDate: today(),
        crewId: null,
        qty: 0,
      }
    case 'owner_direct':
      return {
        ...common,
        customerId: null,
        transactionDate: today(),
        qty: 0,
      }
  }
}

export function materialFormPath(kind: MaterialFormKind, id?: string): string {
  const base = MATERIAL_FORM_META[kind].listPath
  return id ? `${base}/${id}` : `${base}/new`
}
