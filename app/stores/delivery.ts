export interface DeliveryItem {
  name: string
  unit: string
  quantity: string
  unitPrice: string
  total: string
}

export interface DeliveryDoc {
  id: string
  date: string | null
  dateText: string
  orderNo: string
  items: DeliveryItem[]
}

export interface DeliveryFile {
  id: string
  name: string
  kind: 'pdf' | 'image'
  partitionId: string
  company: string
  companySource: '' | 'folder' | 'ocr' | 'manual'
  companyConflict: boolean
  docs: DeliveryDoc[]
  ocrStatus: 'idle' | 'running' | 'done' | 'error'
  ocrError: string
  project: string
  docType: '送货单' | '收据' | ''
  note: string
}

export interface Partition {
  id: string
  name: string
}

const MOCK_PARTITIONS: Partition[] = [
  { id: 'p_all', name: '全部' },
  { id: 'p_1', name: '合和新城' },
  { id: 'p_2', name: '车骏商业大楼' },
]

const MOCK_FILES: DeliveryFile[] = [
  {
    id: 'df_1', name: '大板东建材-送货单-0615.pdf', kind: 'pdf',
    partitionId: 'p_1', company: '广州市大板东建材有限公司',
    companySource: 'folder', companyConflict: false,
    docs: [{
      id: 'dd_1', date: '2026-06-15', dateText: '2026年6月15日', orderNo: 'SH-2026-0615-001',
      items: [
        { name: 'HRB400 螺纹钢 Φ12', unit: '吨', quantity: '25.5', unitPrice: '3800', total: '96900' },
        { name: 'HRB400 螺纹钢 Φ16', unit: '吨', quantity: '18.2', unitPrice: '3850', total: '70070' },
      ],
    }],
    ocrStatus: 'done', ocrError: '', project: '合和新城·3号楼', docType: '送货单', note: '',
  },
  {
    id: 'df_2', name: '大板东建材-送货单-0618.pdf', kind: 'pdf',
    partitionId: 'p_1', company: '广州市大板东建材有限公司',
    companySource: 'ocr', companyConflict: false,
    docs: [{
      id: 'dd_2', date: '2026-06-18', dateText: '2026年6月18日', orderNo: 'SH-2026-0618-003',
      items: [
        { name: 'C30 商品混凝土', unit: 'm³', quantity: '45', unitPrice: '420', total: '18900' },
      ],
    }],
    ocrStatus: 'done', ocrError: '', project: '合和新城·3号楼', docType: '送货单', note: '',
  },
  {
    id: 'df_3', name: '鸿运五金-收据-0620.jpg', kind: 'image',
    partitionId: 'p_2', company: '佛山市南海区鸿运五金建材经营部',
    companySource: 'folder', companyConflict: false,
    docs: [{
      id: 'dd_3', date: '2026-06-20', dateText: '6月20日', orderNo: '',
      items: [
        { name: '水管 PPR Φ25', unit: '米', quantity: '200', unitPrice: '12', total: '2400' },
        { name: '电线 BV 2.5mm²', unit: '米', quantity: '500', unitPrice: '3.5', total: '1750' },
      ],
    }],
    ocrStatus: 'done', ocrError: '', project: '车骏商业大楼', docType: '收据', note: '',
  },
  {
    id: 'df_4', name: '顺利圆铝业-0622.pdf', kind: 'pdf',
    partitionId: 'p_2', company: '', companySource: '',
    companyConflict: false, docs: [],
    ocrStatus: 'idle', ocrError: '', project: '车骏商业大楼', docType: '', note: '',
  },
  {
    id: 'df_5', name: '不清晰扫描件.jpg', kind: 'image',
    partitionId: 'p_1', company: '广州市大板东建材有限公司',
    companySource: 'folder', companyConflict: true, docs: [],
    ocrStatus: 'error', ocrError: '图片模糊无法识别', project: '合和新城·3号楼', docType: '', note: '',
  },
]

export const useDeliveryStore = defineStore('delivery', () => {
  const files = shallowRef<DeliveryFile[]>([])
  const partitions = shallowRef<Partition[]>([])
  const activePartition = shallowRef('p_all')
  const loading = shallowRef(false)

  function load() {
    files.value = [...MOCK_FILES]
    partitions.value = [...MOCK_PARTITIONS]
  }

  function setActivePartition(id: string) {
    activePartition.value = id
  }

  const filteredFiles = computed(() => {
    if (activePartition.value === 'p_all') return files.value
    return files.value.filter(f => f.partitionId === activePartition.value)
  })

  const stats = computed(() => ({
    total: files.value.length,
    idle: files.value.filter(f => f.ocrStatus === 'idle').length,
    done: files.value.filter(f => f.ocrStatus === 'done').length,
    error: files.value.filter(f => f.ocrStatus === 'error').length,
  }))

  function incompleteReasons(f: DeliveryFile): string[] {
    const reasons: string[] = []
    if (f.ocrStatus === 'error') reasons.push('识别失败')
    if (!f.company) reasons.push('缺公司名')
    if (f.companyConflict) reasons.push('公司名冲突')
    if (f.docs.length === 0) reasons.push('无明细')
    for (const doc of f.docs) {
      if (!doc.date) reasons.push('缺日期')
      if (!doc.orderNo && f.docType === '送货单') reasons.push('缺单号')
      if (doc.items.length === 0) reasons.push('0明细行')
    }
    return [...new Set(reasons)]
  }

  return { files: readonly(files), partitions: readonly(partitions), activePartition: readonly(activePartition), loading: readonly(loading), load, setActivePartition, filteredFiles, stats, incompleteReasons }
})
