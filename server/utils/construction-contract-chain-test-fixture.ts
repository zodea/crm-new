import type { CustomerListSourceRow } from '../../app/lib/customer/repository'
import type { ProjectListSourceRow } from '../../app/lib/project/repository'
import type { SupplierListSourceRow } from '../../app/lib/supplier/repository'
import { customerCommandTestInstance } from './customer-command-test-instance'
import { projectCommandTestInstance } from './project-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

const FIXED_AS_OF = '2026-08-15T00:00:00.000Z'

export const CONSTRUCTION_PROJECT_FIXTURE: ProjectListSourceRow = {
  dataOrigin: 'real',
  id: 'project-real-320',
  name: '中央正式施工项目',
  code: 'PROJECT-CENTRAL-320',
  status: '施工中',
  contractAmount: 5200000,
  operationType: '施工总承包',
  startDate: '2026-01-01',
  plannedEnd: '2026-12-31',
  actualEnd: null,
  plannedDuration: 365,
  manager: '项目经理',
  execManager: '',
  builder: '',
  customerId: 'customer-real-320',
  customerName: '中央正式甲方客户',
  customerPermission: 'allowed',
  secondaryCustomerId: null,
  secondaryCustomerName: null,
  secondaryCustomerPermission: 'allowed',
  contractName: '既有中央施工合同',
  contractor: '瑞航工程',
  region: '',
  riskLevel: '',
  address: '',
  income: null,
  budget: null,
  updatedAt: FIXED_AS_OF,
}

export const CONSTRUCTION_CUSTOMER_FIXTURE: CustomerListSourceRow = {
  dataOrigin: 'real',
  id: 'customer-real-320',
  name: '中央正式甲方客户',
  aliases: [],
  taxNo: 'CUSTOMER-CENTRAL-320',
  legalRep: '',
  registeredAddress: '',
  invoiceName: '中央正式甲方客户',
  bank: '',
  bankAccount: '',
  contact: '甲方联系人',
  contactPhone: '',
  status: 'active',
  note: '',
  updatedAt: FIXED_AS_OF,
}

export const linkedSubcontractSupplier: SupplierListSourceRow = {
  dataOrigin: 'real',
  id: 'supplier-real-327',
  name: '中央正式劳务分供方',
  aliases: [],
  externalRef: '',
  uniqueCode: 'SUP-REAL-327',
  taxNo: '',
  businessType: '劳务分包',
  supplierCategory: '劳务分包商',
  rating: '',
  legalRep: '',
  registeredCapital: null,
  registeredDate: null,
  address: '',
  taxpayerType: '',
  mainBusiness: '中央正式分包合同与变洽签关联分供方',
  invoiceName: '中央正式劳务分供方',
  invoiceAddress: '',
  bank: '',
  bankAccount: '',
  phone: '',
  contact: '项目商务联系人',
  contactPhone: '',
  contactTitle: '',
  credentialStatus: 'incomplete',
  note: '',
  updatedAt: '2026-08-26T00:00:00.000Z',
}

/** 仅由开发测试重置入口调用；普通读接口不注入这些样例。 */
export function prepareConstructionContractChainIdentityFixtures(sessionId?: string | null) {
  const project = projectCommandTestInstance.prepareImportedProjects([CONSTRUCTION_PROJECT_FIXTURE], sessionId)
  const supplier = supplierCommandTestInstance.prepareImportedSuppliers([linkedSubcontractSupplier], sessionId)
  const customer = customerCommandTestInstance.prepareMigrationSnapshot({
    authority: 'central',
    activeBatchId: 'contract-test-fixture',
    entities: [{
      entityType: 'customers',
      id: CONSTRUCTION_CUSTOMER_FIXTURE.id,
      legacyId: CONSTRUCTION_CUSTOMER_FIXTURE.id,
      name: CONSTRUCTION_CUSTOMER_FIXTURE.name,
      batchId: 'contract-test-fixture',
      references: {},
      quantity: null,
      amount: null,
      deletedAt: null,
      attributes: { taxNo: CONSTRUCTION_CUSTOMER_FIXTURE.taxNo, invoiceName: CONSTRUCTION_CUSTOMER_FIXTURE.invoiceName, contact: CONSTRUCTION_CUSTOMER_FIXTURE.contact, status: 'active', updatedAt: FIXED_AS_OF },
    }],
  }, sessionId)
  project.commit()
  supplier.commit()
  customer()
}
