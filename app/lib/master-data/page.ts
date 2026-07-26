import type {
  CrewFormDraft,
  CustomerFormDraft,
  MasterDataOwnerType,
  ProjectFormDraft,
  SupplierFormDraft,
  TargetCostFormDraft,
  WorkerFormDraft,
} from './forms'

export type MasterDataPageDraft
  = SupplierFormDraft
    & CustomerFormDraft
    & CrewFormDraft
    & WorkerFormDraft
    & ProjectFormDraft
    & TargetCostFormDraft

export type FormFooterAction = 'cancel' | 'draft' | 'saveNew' | 'saveSubmit' | 'save'

interface FormSection {
  key: string
  label: string
}

interface FormMeta {
  label: string
  listLabel: string
  listPath: string
  newPath: string
  defaultAttachmentCategory: string
  sections: FormSection[]
}

export const FORM_META: Record<MasterDataOwnerType, FormMeta> = {
  supplier: {
    label: '分供方',
    listLabel: '分供方列表',
    listPath: '/base/supplier',
    newPath: '/base/supplier/form',
    defaultAttachmentCategory: '其他',
    sections: [
      { key: 'basic', label: '基础信息' },
      { key: 'contact', label: '联系人信息' },
      { key: 'invoice', label: '开票与银行' },
      { key: 'attachments', label: '证照附件' },
      { key: 'note', label: '备注' },
    ],
  },
  customer: {
    label: '客户',
    listLabel: '客户列表',
    listPath: '/base/customer',
    newPath: '/base/customer/form',
    defaultAttachmentCategory: 'invoice',
    sections: [
      { key: 'basic', label: '基础信息' },
      { key: 'invoice', label: '开票与银行' },
      { key: 'contact', label: '联系信息' },
      { key: 'attachments', label: '开票资料' },
      { key: 'note', label: '备注' },
    ],
  },
  crew: {
    label: '班组',
    listLabel: '班组列表',
    listPath: '/base/crew',
    newPath: '/base/crew/form',
    defaultAttachmentCategory: 'agreement',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'pay', label: '计薪与提成' },
      { key: 'attachments', label: '合作协议' },
      { key: 'note', label: '备注' },
    ],
  },
  worker: {
    label: '工人',
    listLabel: '工人列表',
    listPath: '/base/worker',
    newPath: '/base/worker/form',
    defaultAttachmentCategory: 'certificate',
    sections: [
      { key: 'personal', label: '个人信息' },
      { key: 'bank', label: '银行信息' },
      { key: 'work', label: '工作信息' },
      { key: 'project', label: '项目分配' },
      { key: 'attachments', label: '证书档案' },
      { key: 'note', label: '备注' },
    ],
  },
  project: {
    label: '项目',
    listLabel: '项目列表',
    listPath: '/project',
    newPath: '/project/form',
    defaultAttachmentCategory: 'filing',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'schedule', label: '工期与阶段' },
      { key: 'team', label: '参建单位' },
      { key: 'risk', label: '风控与立项' },
      { key: 'attachments', label: '附件' },
      { key: 'note', label: '备注' },
    ],
  },
  target_cost: {
    label: '目标成本',
    listLabel: '目标成本列表',
    listPath: '/project/target-cost',
    newPath: '/project/target-cost/form',
    defaultAttachmentCategory: 'budget',
    sections: [
      { key: 'basic', label: '基本信息' },
      { key: 'amount', label: '金额基准' },
      { key: 'attachments', label: '附件' },
      { key: 'note', label: '备注' },
    ],
  },
}

export function formDefaults(kind: MasterDataOwnerType): Record<string, unknown> {
  const common = { note: '' }
  switch (kind) {
    case 'supplier':
      return {
        ...common,
        aliases: [],
        taxpayerType: '未核验',
        approvalStatus: 'draft',
      }
    case 'customer':
      return { ...common, aliases: [], status: 'draft' }
    case 'crew':
      return {
        ...common,
        defaultPayRatio: 0.95,
        rentSubsidyEnabled: false,
        mgmtFeeEnabled: false,
        assignmentLevel: 'crew',
        status: 'draft',
      }
    case 'worker':
      return {
        ...common,
        crewId: null,
        currentProjectId: null,
        familyGroupId: null,
        projectStatus: '在场',
        safetyEducation: false,
        status: 'draft',
      }
    case 'project':
      return {
        ...common,
        customerId: null,
        secondaryCustomerId: null,
        operationType: '自营',
        status: '筹备中',
        riskLevel: '低',
        approvalStatus: 'draft',
      }
    case 'target_cost':
      return {
        ...common,
        projectId: null,
        isBaseline: false,
        status: 'draft',
      }
  }
}

export function formRequiredFields(
  kind: MasterDataOwnerType,
): Array<[field: string, label: string]> {
  switch (kind) {
    case 'supplier':
      return [
        ['name', '公司全称'],
        ['supplierCategory', '分供方类别'],
        ['contact', '主要联系人'],
      ]
    case 'customer':
      return [['name', '客户名称'], ['contact', '联系人']]
    case 'crew':
      return [
        ['name', '班组名称'],
        ['trade', '工种'],
        ['contactName', '负责人'],
        ['contactPhone', '联系电话'],
      ]
    case 'worker':
      return [
        ['name', '姓名'],
        ['phone', '联系电话'],
        ['bankName', '开户银行'],
        ['bankAccount', '银行卡号'],
        ['trade', '工种'],
      ]
    case 'project':
      return [
        ['name', '项目名称'],
        ['customerId', '客户'],
        ['manager', '项目经理'],
      ]
    case 'target_cost':
      return [['name', '版本名'], ['projectId', '项目']]
  }
}
