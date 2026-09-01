import type { ProjectListSourceRow } from '../../app/lib/project/repository'
import type { SupplierListSourceRow } from '../../app/lib/supplier/repository'
import { projectCommandTestInstance } from './project-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

export const MATERIAL_CONTRACT_CHAIN_PROJECT: ProjectListSourceRow = {
  dataOrigin: 'real',
  id: 'project-real-318',
  name: '中央正式材料项目',
  code: 'XM-CENTRAL-318',
  status: '在建',
  contractAmount: null,
  operationType: '',
  startDate: null,
  plannedEnd: null,
  actualEnd: null,
  plannedDuration: null,
  manager: '',
  execManager: '',
  builder: '',
  customerId: null,
  customerName: null,
  customerPermission: 'allowed',
  secondaryCustomerId: null,
  secondaryCustomerName: null,
  secondaryCustomerPermission: 'allowed',
  contractName: '',
  contractor: '',
  region: '',
  riskLevel: '',
  address: '',
  income: null,
  budget: null,
  updatedAt: '2026-01-08T00:00:00.000Z',
}

export const MATERIAL_CONTRACT_CHAIN_SUPPLIER: SupplierListSourceRow = {
  dataOrigin: 'real',
  id: 'supplier-real-318',
  name: '中央正式材料供应商',
  aliases: [],
  externalRef: '',
  uniqueCode: 'SUP-CENTRAL-318',
  taxNo: '',
  businessType: '',
  supplierCategory: '材料供应商',
  rating: '',
  legalRep: '',
  registeredCapital: null,
  registeredDate: null,
  address: '',
  taxpayerType: '',
  mainBusiness: '',
  invoiceName: '中央正式材料供应商',
  invoiceAddress: '',
  bank: '',
  bankAccount: '',
  phone: '',
  contact: '',
  contactPhone: '',
  contactTitle: '',
  credentialStatus: 'incomplete',
  note: '材料采购合同只读链的中央身份测试夹具',
  updatedAt: '2026-01-08T00:00:00.000Z',
}

export function prepareMaterialContractChainIdentityFixtures(sessionId?: string | null): void {
  const project = projectCommandTestInstance.prepareImportedProjects([MATERIAL_CONTRACT_CHAIN_PROJECT], sessionId)
  const supplier = supplierCommandTestInstance.prepareImportedSuppliers([MATERIAL_CONTRACT_CHAIN_SUPPLIER], sessionId)
  try {
    project.commit()
    supplier.commit()
  }
  catch (cause) {
    supplier.rollback()
    project.rollback()
    throw cause
  }
}
