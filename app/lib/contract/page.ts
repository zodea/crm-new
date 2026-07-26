import type {
  F2FormDraft,
  F2FormKind,
  ProjectContractFormDraft,
} from '~/lib/contract/forms'

export interface ContractFormSection {
  key: string
  label: string
}

export interface ContractFormMeta {
  label: string
  subtitle: string
  listLabel: string
  listPath: string
  newPath: string
  sections: ContractFormSection[]
}

const COMMON_CONTRACT_SECTIONS: ContractFormSection[] = [
  { key: 'basic', label: '基本信息' },
  { key: 'amount', label: '合同金额' },
  { key: 'terms', label: '合同条款' },
  { key: 'retention', label: '质保金信息' },
  { key: 'invoice', label: '开票方信息' },
  { key: 'attachments', label: '附件与备注' },
]

export const F2_FORM_META: Record<F2FormKind, ContractFormMeta> = {
  construction: {
    label: '施工合同',
    subtitle: '收入侧主合同 · 甲方客户 · 乙方为我方',
    listLabel: '施工合同',
    listPath: '/contract/construction',
    newPath: '/contract/construction/form',
    sections: COMMON_CONTRACT_SECTIONS,
  },
  subcontract: {
    label: '分包合同',
    subtitle: '支出侧 · 劳务/专业分包 · 乙方分供方',
    listLabel: '分包合同',
    listPath: '/contract/subcontract',
    newPath: '/contract/subcontract/form',
    sections: COMMON_CONTRACT_SECTIONS,
  },
  material: {
    label: '材料采购合同',
    subtitle: '支出侧 · 乙供材 · 采购合同明细',
    listLabel: '材料采购合同',
    listPath: '/contract/material',
    newPath: '/contract/material/form',
    sections: [
      ...COMMON_CONTRACT_SECTIONS.slice(0, 5),
      { key: 'lines', label: '采购合同明细' },
      COMMON_CONTRACT_SECTIONS.at(-1)!,
    ],
  },
  other_expense: {
    label: '其他支出合同',
    subtitle: '项目杂项支出 · 机械租赁/检测服务/其他',
    listLabel: '其他支出合同',
    listPath: '/contract/other-expense',
    newPath: '/contract/other-expense/form',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '合同金额' },
      { key: 'terms', label: '条款与附件' },
      { key: 'attachments', label: '经办与备注' },
    ],
  },
  company_expense: {
    label: '公司支出合同',
    subtitle: '公司层面 · 房租/软件/其他 · 不挂项目',
    listLabel: '公司支出合同',
    listPath: '/contract/company-expense',
    newPath: '/contract/company-expense/form',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '合同金额' },
      { key: 'terms', label: '条款与附件' },
      { key: 'attachments', label: '经办与备注' },
    ],
  },
  other_settlement: {
    label: '其他支出结算',
    subtitle: '其他支出合同结算单 · 项目级联',
    listLabel: '其他支出结算',
    listPath: '/contract/other-settlement',
    newPath: '/contract/other-settlement/form',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '结算金额' },
      { key: 'contract', label: '合同情况' },
      { key: 'attachments', label: '经办与备注' },
    ],
  },
  material_settlement: {
    label: '材料采购结算',
    subtitle: '材料采购合同对账结算 · 复用统一支出结算事实',
    listLabel: '材料采购结算',
    listPath: '/material/settlement',
    newPath: '/material/settlement/form',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '结算金额' },
      { key: 'contract', label: '合同情况' },
      { key: 'attachments', label: '对账附件' },
    ],
  },
}

function compactDate(): string {
  return new Date().toISOString().slice(0, 10).replaceAll('-', '')
}

function generatedNo(prefix: string): string {
  return `${prefix}-${compactDate()}-${Math.floor(Math.random() * 900 + 100)}`
}

export function f2FormDefaults(kind: F2FormKind): F2FormDraft {
  switch (kind) {
    case 'construction':
    case 'subcontract':
    case 'material':
    case 'other_expense': {
      const prefixes: Record<typeof kind, string> = {
        construction: 'RJ-SG',
        subcontract: 'RJ-FB',
        material: 'RJ-CG',
        other_expense: 'QT',
      }
      return {
        no: generatedNo(prefixes[kind]),
        name: '',
        projectId: null,
        customerId: null,
        supplierId: null,
        subKind: kind === 'subcontract' ? '劳务' : '',
        isSupplement: false,
        originalContractId: null,
        content: '',
        signDate: '',
        status: '草稿',
        invoiceType: '增值税专用发票',
        taxRate: kind === 'material' ? 13 : 9,
        otherExpenseKind: kind === 'other_expense' ? '机械租赁' : '',
        paymentCycle: kind === 'other_expense' ? '月付' : '',
        amount: 0,
        lineItems: [],
      } satisfies ProjectContractFormDraft
    }
    case 'company_expense':
      return {
        no: generatedNo('GS'),
        name: '',
        category: '其他',
        counterparty: '',
        signDate: '',
        servicePeriod: '',
        amount: 0,
        paymentCycle: '月付',
        mainTerms: '',
        status: '草稿',
        note: '',
      }
    case 'other_settlement':
      return {
        no: generatedNo('QTJS'),
        name: '',
        projectId: null,
        contractId: null,
        totalAmount: 0,
        settlementDate: '',
        status: '草稿',
        note: '',
      }
    case 'material_settlement':
      return {
        no: generatedNo('CGJS'),
        name: '',
        projectId: null,
        contractId: null,
        settlementType: '材料采购结算',
        totalAmount: 0,
        settlementDate: '',
        status: '草稿',
        note: '',
      }
  }
}

export function formPath(kind: F2FormKind, id?: string): string {
  const base = F2_FORM_META[kind].newPath
  return id ? `${base}/${id}` : base
}
