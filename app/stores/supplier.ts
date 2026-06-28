import { generateId } from '~/lib/util/id'
import { execute, select } from '~/lib/db/connection'

export interface Supplier {
  id: string
  name: string
  aliases: string[]
  uniqueCode: string
  taxNo: string
  businessType: string
  supplierCategory: string
  rating: string
  parentSupplierId: string | null
  legalRep: string
  registeredCapital: number | null
  registeredDate: string
  address: string
  taxpayerType: string
  mainBusiness: string
  invoiceName: string
  invoiceAddress: string
  bank: string
  bankAccount: string
  phone: string
  contact: string
  contactPhone: string
  credentialStatus: string
  approvalStatus: string
  source: string
  note: string
  createdAt: string
  updatedAt: string
}

function rowToSupplier(row: Record<string, unknown>): Supplier {
  let aliases: string[] = []
  try { aliases = JSON.parse((row.aliases as string) || '[]') } catch {}
  return {
    id: row.id as string,
    name: row.name as string,
    aliases,
    uniqueCode: (row.unique_code ?? '') as string,
    taxNo: (row.tax_no ?? '') as string,
    businessType: (row.business_type ?? '') as string,
    supplierCategory: (row.supplier_category ?? '') as string,
    rating: (row.rating ?? '') as string,
    parentSupplierId: (row.parent_supplier_id ?? null) as string | null,
    legalRep: (row.legal_rep ?? '') as string,
    registeredCapital: row.registered_capital as number | null,
    registeredDate: (row.registered_date ?? '') as string,
    address: (row.address ?? '') as string,
    taxpayerType: (row.taxpayer_type ?? '') as string,
    mainBusiness: (row.main_business ?? '') as string,
    invoiceName: (row.invoice_name ?? '') as string,
    invoiceAddress: (row.invoice_address ?? '') as string,
    bank: (row.bank ?? '') as string,
    bankAccount: (row.bank_account ?? '') as string,
    phone: (row.phone ?? '') as string,
    contact: (row.contact ?? '') as string,
    contactPhone: (row.contact_phone ?? '') as string,
    credentialStatus: (row.credential_status ?? 'incomplete') as string,
    approvalStatus: (row.approval_status ?? 'draft') as string,
    source: (row.source ?? 'manual') as string,
    note: (row.note ?? '') as string,
    createdAt: (row.created_at ?? '') as string,
    updatedAt: (row.updated_at ?? '') as string,
  }
}

export const useSupplierStore = defineStore('supplier', () => {
  const list = ref<Supplier[]>([])
  const loading = ref(false)

  async function load() {
    loading.value = true
    try {
      const rows = await select<Record<string, unknown>>('SELECT * FROM suppliers ORDER BY created_at DESC')
      list.value = rows.map(rowToSupplier)
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(s => s.id === id)
  }

  async function add(data: Partial<Supplier>) {
    const id = generateId('sup')
    const now = new Date().toISOString()
    await execute(
      `INSERT INTO suppliers (id, name, aliases, unique_code, tax_no, business_type, supplier_category, rating, parent_supplier_id, legal_rep, registered_capital, registered_date, address, taxpayer_type, main_business, invoice_name, invoice_address, bank, bank_account, phone, contact, contact_phone, credential_status, approval_status, source, note, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, data.name ?? '', JSON.stringify(data.aliases ?? []),
        data.uniqueCode ?? '', data.taxNo ?? '',
        data.businessType ?? '', data.supplierCategory ?? '', data.rating ?? '',
        data.parentSupplierId ?? null,
        data.legalRep ?? '', data.registeredCapital ?? null, data.registeredDate ?? '',
        data.address ?? '', data.taxpayerType ?? '', data.mainBusiness ?? '',
        data.invoiceName ?? '', data.invoiceAddress ?? '',
        data.bank ?? '', data.bankAccount ?? '', data.phone ?? '',
        data.contact ?? '', data.contactPhone ?? '',
        data.credentialStatus ?? 'incomplete', data.approvalStatus ?? 'draft',
        data.source ?? 'manual', data.note ?? '',
        now, now,
      ],
    )
    await load()
    return id
  }

  async function update(id: string, data: Partial<Supplier>) {
    const now = new Date().toISOString()
    await execute(
      `UPDATE suppliers SET name=?, aliases=?, unique_code=?, tax_no=?, business_type=?, supplier_category=?, rating=?, parent_supplier_id=?, legal_rep=?, registered_capital=?, registered_date=?, address=?, taxpayer_type=?, main_business=?, invoice_name=?, invoice_address=?, bank=?, bank_account=?, phone=?, contact=?, contact_phone=?, note=?, updated_at=? WHERE id=?`,
      [
        data.name ?? '', JSON.stringify(data.aliases ?? []),
        data.uniqueCode ?? '', data.taxNo ?? '',
        data.businessType ?? '', data.supplierCategory ?? '', data.rating ?? '',
        data.parentSupplierId ?? null,
        data.legalRep ?? '', data.registeredCapital ?? null, data.registeredDate ?? '',
        data.address ?? '', data.taxpayerType ?? '', data.mainBusiness ?? '',
        data.invoiceName ?? '', data.invoiceAddress ?? '',
        data.bank ?? '', data.bankAccount ?? '', data.phone ?? '',
        data.contact ?? '', data.contactPhone ?? '',
        data.note ?? '', now, id,
      ],
    )
    await load()
  }

  async function remove(id: string) {
    await execute('DELETE FROM suppliers WHERE id = ?', [id])
    await load()
  }

  return { list, loading, load, byId, add, update, remove }
})
