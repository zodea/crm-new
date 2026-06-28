import { generateId } from '~/lib/util/id'
import { execute, select } from '~/lib/db/connection'

export interface Invoice {
  id: string
  fileName: string
  filePath: string
  fileSize: string
  pageCount: number
  invoiceType: string
  invoiceNumber: string
  invoiceDate: string
  buyer: string
  buyerTaxNo: string
  seller: string
  sellerTaxNo: string
  amount: number
  taxAmount: number
  totalAmount: number
  taxRate: string
  remark: string
  projectId: string | null
  projectName: string
  supplierId: string | null
  ocrStatus: 'pending' | 'processing' | 'done' | 'failed'
  reviewStatus: 'unreviewed' | 'reviewed'
  accountStatus: 'none' | 'confirmed'
  dupStatus: 'normal' | 'duplicate'
  source: 'scan' | 'excel'
  printRotation: number
  ocrConfidence: number | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
}

const MOCK_INVOICES: Partial<Invoice>[] = [
  {
    fileName: 'scan_0615_001.pdf', fileSize: '1.2 MB', pageCount: 1,
    invoiceType: '增值税专用发票', invoiceNumber: '09442026000058760',
    invoiceDate: '2026-06-15', buyer: '广州市瑞航建筑工程有限公司',
    seller: '广州市大板东建材有限公司', amount: 113841.77, taxAmount: 14798.23,
    totalAmount: 128640.00, taxRate: '13%', projectName: '合和新城·3号楼',
    ocrStatus: 'done', reviewStatus: 'reviewed', accountStatus: 'confirmed',
    source: 'scan', ocrConfidence: 0.96,
  },
  {
    fileName: 'scan_0615_002.pdf', fileSize: '0.9 MB', pageCount: 1,
    invoiceType: '增值税专用发票', invoiceNumber: '09442026000058761',
    invoiceDate: '2026-06-15', buyer: '广州市瑞航建筑工程有限公司',
    seller: '广州市大板东建材有限公司', amount: 40000.00, taxAmount: 5200.00,
    totalAmount: 45200.00, taxRate: '13%', projectName: '合和新城·3号楼',
    ocrStatus: 'done', reviewStatus: 'unreviewed', accountStatus: 'none',
    source: 'scan', ocrConfidence: 0.92,
  },
  {
    fileName: 'scan_0618_003.pdf', fileSize: '1.5 MB', pageCount: 1,
    invoiceType: '增值税普通发票', invoiceNumber: '09442026000062100',
    invoiceDate: '2026-06-18', buyer: '广州市瑞航建筑工程有限公司',
    seller: '佛山市南海区鸿运五金建材经营部', amount: 8500.00, taxAmount: 255.00,
    totalAmount: 8755.00, taxRate: '3%', projectName: '车骏商业大楼',
    ocrStatus: 'done', reviewStatus: 'unreviewed', accountStatus: 'none',
    source: 'scan', ocrConfidence: 0.88,
  },
  {
    fileName: 'scan_0620_004.pdf', fileSize: '1.1 MB', pageCount: 1,
    invoiceType: '增值税专用发票', invoiceNumber: '09442026000058760',
    invoiceDate: '2026-06-20', buyer: '广州市瑞航建筑工程有限公司',
    seller: '广州市顺利圆铝业有限公司', amount: 75000.00, taxAmount: 9750.00,
    totalAmount: 84750.00, taxRate: '13%', remark: '铝单板一批',
    ocrStatus: 'done', reviewStatus: 'unreviewed', accountStatus: 'none',
    dupStatus: 'duplicate', source: 'scan', ocrConfidence: 0.94,
  },
  {
    fileName: 'scan_0622_005.pdf', fileSize: '0.8 MB', pageCount: 1,
    invoiceType: '', invoiceNumber: '',
    ocrStatus: 'pending', reviewStatus: 'unreviewed', accountStatus: 'none',
    source: 'scan',
  },
  {
    fileName: '', invoiceType: '增值税专用发票',
    invoiceNumber: '09442026000055001', invoiceDate: '2026-05-10',
    buyer: '广州市瑞航建筑工程有限公司', seller: '广州市大板东建材有限公司',
    amount: 200000.00, taxAmount: 26000.00, totalAmount: 226000.00,
    taxRate: '13%', projectName: '合和新城·3号楼',
    ocrStatus: 'done', reviewStatus: 'reviewed', accountStatus: 'confirmed',
    source: 'excel',
  },
]

export const useInvoiceStore = defineStore('invoice', () => {
  const list = ref<Invoice[]>([])
  const loading = ref(false)

  function initMockData() {
    const now = new Date().toISOString()
    list.value = MOCK_INVOICES.map((m, i) => ({
      id: `inv_mock_${i}`,
      fileName: m.fileName ?? '',
      filePath: '',
      fileSize: m.fileSize ?? '',
      pageCount: m.pageCount ?? 0,
      invoiceType: m.invoiceType ?? '',
      invoiceNumber: m.invoiceNumber ?? '',
      invoiceDate: m.invoiceDate ?? '',
      buyer: m.buyer ?? '',
      buyerTaxNo: m.buyerTaxNo ?? '',
      seller: m.seller ?? '',
      sellerTaxNo: m.sellerTaxNo ?? '',
      amount: m.amount ?? 0,
      taxAmount: m.taxAmount ?? 0,
      totalAmount: m.totalAmount ?? 0,
      taxRate: m.taxRate ?? '',
      remark: m.remark ?? '',
      projectId: m.projectId ?? null,
      projectName: m.projectName ?? '',
      supplierId: m.supplierId ?? null,
      ocrStatus: m.ocrStatus ?? 'pending',
      reviewStatus: m.reviewStatus ?? 'unreviewed',
      accountStatus: m.accountStatus ?? 'none',
      dupStatus: m.dupStatus ?? 'normal',
      source: m.source ?? 'scan',
      printRotation: 0,
      ocrConfidence: m.ocrConfidence ?? null,
      confirmedAt: m.accountStatus === 'confirmed' ? now : null,
      createdAt: now,
      updatedAt: now,
    }))
  }

  async function load() {
    loading.value = true
    try {
      initMockData()
    }
    finally {
      loading.value = false
    }
  }

  function byId(id: string) {
    return list.value.find(inv => inv.id === id)
  }

  const documents = computed(() =>
    list.value.filter(inv => inv.source === 'scan'),
  )

  const pendingReview = computed(() =>
    list.value.filter(inv =>
      inv.ocrStatus === 'done'
      && inv.reviewStatus === 'unreviewed'
      && inv.dupStatus === 'normal',
    ),
  )

  const ledger = computed(() =>
    list.value.filter(inv =>
      inv.accountStatus === 'confirmed' || inv.source === 'excel',
    ),
  )

  function confirmInvoice(id: string) {
    const inv = byId(id)
    if (inv) {
      inv.reviewStatus = 'reviewed'
      inv.accountStatus = 'confirmed'
      inv.confirmedAt = new Date().toISOString()
    }
  }

  function updateField(id: string, field: keyof Invoice, value: unknown) {
    const inv = byId(id)
    if (inv) {
      (inv as any)[field] = value
      inv.updatedAt = new Date().toISOString()
    }
  }

  return { list, loading, load, byId, documents, pendingReview, ledger, confirmInvoice, updateField }
})
