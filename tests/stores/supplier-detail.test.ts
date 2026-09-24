import type { TestDb } from '../helpers/memory-db'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runMigrations } from '~/lib/db/migrations'
import { useSupplierStore } from '~/stores/supplier'
import { useSupplierDetailStore } from '~/stores/supplier-detail'
import { createMemoryDb } from '../helpers/memory-db'

let mem: TestDb
let failCredentialStatusUpdate = false
let failRefreshAfterCommit = false
let refreshReadsFail = false
let connectionSelectCount = 0
let transactionCount = 0

vi.mock('~/lib/db/connection', () => ({
  execute: async (sql: string, params?: unknown[]) => {
    if (failCredentialStatusUpdate && sql.includes('SET credential_status = ?'))
      throw new Error('模拟资料状态写入失败')
    return mem.execute(sql, params)
  },
  select: async (sql: string, params?: unknown[]) => {
    connectionSelectCount += 1
    if (refreshReadsFail)
      throw new Error('模拟缓存刷新失败')
    return mem.select(sql, params)
  },
  withTransaction: async <T>(work: (tx: Pick<TestDb, 'execute' | 'select'>) => Promise<T>) => {
    transactionCount += 1
    await mem.execute('BEGIN')
    try {
      const result = await work({
        execute: async (sql: string, params?: unknown[]) => {
          if (failCredentialStatusUpdate && sql.includes('SET credential_status = ?'))
            throw new Error('模拟资料状态写入失败')
          return mem.execute(sql, params)
        },
        select: (sql, params) => mem.select(sql, params),
      })
      await mem.execute('COMMIT')
      if (failRefreshAfterCommit) {
        failRefreshAfterCommit = false
        refreshReadsFail = true
      }
      return result
    }
    catch (error) {
      await mem.execute('ROLLBACK')
      throw error
    }
  },
}))

beforeEach(async () => {
  failCredentialStatusUpdate = false
  failRefreshAfterCommit = false
  refreshReadsFail = false
  connectionSelectCount = 0
  transactionCount = 0
  mem = await createMemoryDb()
  await runMigrations(mem)
  setActivePinia(createPinia())

  await mem.execute(`INSERT INTO projects (id, name, status) VALUES ('p1', '项目甲', '在建')`)
  await mem.execute(`INSERT INTO suppliers (id, name, credential_status) VALUES ('s1', '测试分供方', 'incomplete')`)
  await mem.execute(`
    INSERT INTO project_suppliers (id, project_id, supplier_id, status)
    VALUES ('ps1', 'p1', 's1', 'contracted')
  `)
  await mem.execute(`
    INSERT INTO contracts (id, no, name, kind, project_id, supplier_id, amount, paid, status)
    VALUES ('c1', 'C-1', '采购合同', '材采', 'p1', 's1', 1000, 600, '履约中')
  `)
  await mem.execute(`
    INSERT INTO payment_applications
      (id, project_id, supplier_id, no, name, biz_type, apply_amount,
       apply_date, applicant, invoice_state, approved_amount, status)
    VALUES (
      'pay1', 'p1', 's1', 'PAY-1', '进度请款', '项目费用', 400,
      '2026-07-01', '张工', '先款后票', 300, 'approved'
    )
  `)
  await mem.execute(`
    INSERT INTO payment_records (
      id, no, project_id, supplier_id, payee_name, payment_date, amount,
      voucher_no, bank_serial_no, confirmation_status
    )
    VALUES (
      'record1', 'ZF-1', 'p1', 's1', '测试分供方', '2026-07-02', 200,
      'V-1', 'BANK-1', 'needs_review'
    )
  `)
  await mem.execute(`
    INSERT INTO payment_record_application_allocations (
      id, payment_record_id, payment_application_id, allocated_amount
    )
    VALUES ('record-allocation1', 'record1', 'pay1', 200)
  `)
  await mem.execute(`
    UPDATE payment_records
    SET confirmation_status = 'confirmed', confirmed_by = '测试财务',
        confirmed_at = '2026-07-02T09:00:00.000Z'
    WHERE id = 'record1'
  `)
  await mem.execute(`
    INSERT INTO invoices
      (id, invoice_number, invoice_type, invoice_date, project_id, supplier_id, total_amount, tax_amount, account_status)
    VALUES ('inv1', 'INV-1', '增值税专票', '2026-07-01', 'p1', 's1', 120, 20, 'archived')
  `)
  await mem.execute(`
    INSERT INTO supplier_credentials (id, supplier_id, category, file_name)
    VALUES ('cred1', 's1', '营业执照', '营业执照.pdf')
  `)
  await mem.execute(`
    INSERT INTO supplier_credentials (id, supplier_id, category, file_name)
    VALUES ('cred2', 's1', '法人身份证', '法人身份证.jpg')
  `)
  await mem.execute(`
    INSERT INTO file_refs (
      id, owner_type, owner_id, file_name, file_size, mime_type, category
    )
    VALUES
      ('file-cred1', 'supplier_credential', 'cred1', '营业执照.pdf', 4, 'application/pdf', '营业执照'),
      ('file-cred2', 'supplier_credential', 'cred2', '法人身份证.jpg', 3, 'image/jpeg', '法人身份证')
  `)
  await mem.execute(`
    INSERT INTO file_payloads (file_ref_id, encoding, content)
    VALUES
      ('file-cred1', 'base64', 'AQIDBA=='),
      ('file-cred2', 'base64', 'BQYH')
  `)
  await mem.execute(`
    UPDATE supplier_credentials
    SET file_ref_id = CASE id
      WHEN 'cred1' THEN 'file-cred1'
      WHEN 'cred2' THEN 'file-cred2'
    END
    WHERE id IN ('cred1', 'cred2')
  `)
})

afterEach(() => {
  mem.close()
})

describe('supplier detail store', () => {
  it('分供方本地快照区分未填、明确零与历史未知，保留确认银行实付', async () => {
    const store = useSupplierDetailStore()
    for (const [amount, origin, state, claimed] of [[null, 'user-entry', 'not-entered', null], [0, 'user-entry', 'known', 0], [0, 'legacy', 'legacy-unknown', null]] as const) {
      await mem.execute('UPDATE payment_applications SET approved_amount = ?, approved_amount_origin = ? WHERE id = ?', [amount, origin, 'pay1'])
      await store.loadReadonlySnapshot('s1')
      const snapshot = store.bySupplier('s1')
      expect(snapshot.payments[0]).toMatchObject({ approvedAmount: state === 'known' ? 0 : null, approvedAmountState: state, paidAmount: 200 })
      expect(snapshot.summary.claimedTotal).toBe(claimed)
    }
  })
  it('只读快照只执行查询，不启动状态同步事务或改写测试分供方', async () => {
    await mem.execute(`UPDATE suppliers SET credential_status = 'reviewing' WHERE id = 's1'`)
    const store = useSupplierDetailStore()

    await store.loadReadonlySnapshot('s1')

    expect(transactionCount).toBe(0)
    expect(store.bySupplier('s1').credentials).toHaveLength(2)
    const [supplier] = await mem.select<{ credential_status: string }>(
      `SELECT credential_status FROM suppliers WHERE id = 's1'`,
    )
    expect(supplier?.credential_status).toBe('reviewing')
  })

  it('列表聚合排除已软删项目及其合同、付款和合作关系', async () => {
    const supplierStore = useSupplierStore()
    await supplierStore.load()

    expect(supplierStore.listStats.s1).toEqual({
      projectCount: 1,
      contractTotal: 1000,
      paidTotal: 200,
      payableBalance: 800,
      projectIds: ['p1'],
    })
    expect(supplierStore.projectOptions).toEqual([{ id: 'p1', name: '项目甲' }])

    await mem.execute(`
      UPDATE projects
      SET deleted_at = '2026-07-30T00:00:00.000Z'
      WHERE id = 'p1'
    `)
    await supplierStore.load()

    expect(supplierStore.byId('s1')).toBeTruthy()
    expect(supplierStore.listStats.s1).toEqual({
      projectCount: 0,
      contractTotal: 0,
      paidTotal: 0,
      payableBalance: 0,
      projectIds: [],
    })
    expect(supplierStore.projectOptions).toEqual([])
  })

  it('deduplicates overlapping loads for the same supplier and keeps loading state accurate', async () => {
    const store = useSupplierDetailStore()
    const first = store.load('s1')
    const second = store.load('s1')

    expect(store.isLoading('s1')).toBe(true)
    await Promise.all([first, second])

    expect(connectionSelectCount).toBe(6)
    expect(store.isLoading('s1')).toBe(false)
    expect(store.hasSnapshot('s1')).toBe(true)
  })

  it('按 supplierId 缓存 6 Tab 数据并实时计算跨项目汇总', async () => {
    await mem.execute(`UPDATE suppliers SET credential_status = 'reviewing' WHERE id = 's1'`)
    const supplierStore = useSupplierStore()
    const store = useSupplierDetailStore()
    expect(store.hasSnapshot('s1')).toBe(false)
    await store.load('s1')
    expect(store.hasSnapshot('s1')).toBe(true)

    const snapshot = store.bySupplier('s1')
    expect(snapshot.credentials).toHaveLength(2)
    expect(snapshot.credentials.find(row => row.id === 'cred1')).toMatchObject({
      fileRefId: 'file-cred1',
      fileSize: 4,
      mimeType: 'application/pdf',
      hasAccessibleFile: true,
      fileRef: {
        id: 'file-cred1',
        ownerType: 'supplier_credential',
        ownerId: 'cred1',
        fileSize: 4,
        mimeType: 'application/pdf',
      },
    })
    expect(snapshot.projects).toEqual([
      expect.objectContaining({
        projectId: 'p1',
        contractTotal: 1000,
        paidTotal: 200,
        payableBalance: 800,
      }),
    ])
    expect(snapshot.contracts).toHaveLength(1)
    expect(snapshot.payments).toEqual([
      expect.objectContaining({ applicationNo: 'PAY-1', approvedAmount: 300 }),
    ])
    expect(snapshot.invoices).toEqual([
      expect.objectContaining({ invoiceNumber: 'INV-1', totalAmount: 120 }),
    ])
    expect(snapshot.summary).toEqual({
      projectCount: 1,
      contractCount: 1,
      contractTotal: 1000,
      settledTotal: 0,
      claimedTotal: 300,
      invoiceTotal: 120,
      invoiceTaxTotal: 20,
      paidTotal: 200,
      payableBalance: 800,
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('incomplete')
  })

  it('证照新增/软删除/撤回均持久化，并同步回算共享 Supplier 自动态', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    await Promise.all([supplierStore.load(), detailStore.load('s1')])

    const id = await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '开户许可证.pdf', payloadBase64: 'AQ==' },
    })
    expect(detailStore.bySupplier('s1').credentials).toHaveLength(3)
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('reviewing')

    const logId = await detailStore.removeCredential(id, 's1')
    expect(logId).toBeTruthy()
    expect(detailStore.bySupplier('s1').credentials).toHaveLength(2)
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('incomplete')
    expect(await mem.select(
      `SELECT deleted_at FROM supplier_credentials WHERE id = ?`,
      [id],
    )).toEqual([{ deleted_at: expect.any(String) }])
    expect(await mem.select(
      `SELECT id FROM operation_logs
       WHERE table_name = 'supplier_credentials' AND action = 'delete'`,
    )).toEqual([])

    await expect(detailStore.undoCredential(logId!, 's1')).resolves.toBe(true)
    expect(detailStore.bySupplier('s1').credentials).toHaveLength(3)
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('reviewing')
    expect(await mem.select(
      `SELECT deleted_at FROM supplier_credentials WHERE id = ?`,
      [id],
    )).toEqual([{ deleted_at: null }])
  })

  it('证照写入、操作日志与资料状态同事务回滚，并校验证照归属', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')

    failCredentialStatusUpdate = true
    await expect(detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '开户许可证.pdf', payloadBase64: 'AQ==' },
    })).rejects.toThrow('模拟资料状态写入失败')
    failCredentialStatusUpdate = false

    expect(await mem.select(
      `SELECT id FROM supplier_credentials WHERE supplier_id = 's1' AND category = '银行账户资料'`,
    )).toEqual([])
    expect(await mem.select(
      `SELECT id FROM operation_logs WHERE table_name = 'supplier_credentials' AND action = 'create'`,
    )).toEqual([])

    await mem.execute(`INSERT INTO suppliers (id, name, credential_status) VALUES ('s2', '另一分供方', 'incomplete')`)
    await expect(detailStore.removeCredential('cred1', 's2')).rejects.toThrow('证照不属于当前分供方')
    expect(await mem.select(`SELECT deleted_at FROM supplier_credentials WHERE id = 'cred1'`))
      .toEqual([{ deleted_at: null }])
  })

  it('事务已提交但双缓存刷新失败时返回明确的已保存提示', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')

    failRefreshAfterCommit = true
    await expect(detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '开户许可证.pdf', payloadBase64: 'AQ==' },
    })).rejects.toThrow('数据已保存，但界面刷新失败，请刷新后继续：模拟缓存刷新失败')

    refreshReadsFail = false
    expect(await mem.select(
      `SELECT category FROM supplier_credentials WHERE supplier_id = 's1' AND category = '银行账户资料'`,
    )).toEqual([{ category: '银行账户资料' }])
    expect(await mem.select(`SELECT credential_status FROM suppliers WHERE id = 's1'`))
      .toEqual([{ credential_status: 'reviewing' }])
  })

  it('多文件证照在单一事务保存 credential、file_ref 与 payload，任一无效则整体回滚', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')

    const ids = await detailStore.addCredentials({
      supplierId: 's1',
      category: '银行开户许可证',
      files: [
        {
          fileName: '基本存款账户信息.pdf',
          mimeType: 'application/pdf',
          fileSize: 4,
          payloadBase64: 'AQIDBA==',
        },
        {
          fileName: '开户资料补充.png',
          mimeType: 'image/png',
          fileSize: 3,
          payloadBase64: 'BQYH',
        },
      ],
    })

    expect(ids).toHaveLength(2)
    const credentials = await mem.select<{
      id: string
      category: string
      file_ref_id: string
    }>(
      `SELECT id, category, file_ref_id
       FROM supplier_credentials
       WHERE id IN (?, ?)
       ORDER BY file_name`,
      ids,
    )
    expect(credentials).toHaveLength(2)
    expect(credentials.every(row => row.category === '银行账户资料')).toBe(true)
    const refs = await mem.select<{ owner_type: string, owner_id: string }>(
      `SELECT owner_type, owner_id
       FROM file_refs WHERE id IN (?, ?)
       ORDER BY file_name`,
      credentials.map(row => row.file_ref_id),
    )
    expect(refs.every(row => row.owner_type === 'supplier_credential')).toBe(true)
    expect(new Set(refs.map(row => row.owner_id))).toEqual(new Set(ids))
    expect(await mem.select(
      `SELECT file_ref_id FROM file_payloads WHERE file_ref_id IN (?, ?)`,
      credentials.map(row => row.file_ref_id),
    )).toHaveLength(2)

    const before = (await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM supplier_credentials WHERE supplier_id = 's1'`,
    ))[0]!.n
    await expect(detailStore.addCredentials({
      supplierId: 's1',
      category: '完税证明',
      files: [
        { fileName: '有效.pdf', payloadBase64: 'AQ==' },
        { fileName: '   ', payloadBase64: 'Ag==' },
      ],
    })).rejects.toThrow('证照文件名必填')
    expect((await mem.select<{ n: number }>(
      `SELECT COUNT(*) AS n FROM supplier_credentials WHERE supplier_id = 's1'`,
    ))[0]!.n).toBe(before)

    await expect(detailStore.addCredential({
      supplierId: 's1',
      category: '完税证明',
      file: { fileName: '只有名称.pdf' },
    })).rejects.toThrow('证照必须包含可访问的原件')
  })

  it('证照上传的普通日志不记录敏感文件名、路径或上传人', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')
    const id = await detailStore.addCredential({
      supplierId: 's1',
      category: '完税证明',
      file: {
        fileName: 'SECRET-TAX-完税证明.pdf',
        filePath: 'D:\\客户隐私\\SECRET-PATH\\完税证明.pdf',
        uploader: '敏感经办人',
      },
    })
    const [file] = await mem.select<{ file_ref_id: string }>(
      `SELECT file_ref_id FROM supplier_credentials WHERE id = ?`,
      [id],
    )
    const logs = await mem.select<{ after_data: string }>(
      `SELECT after_data
       FROM operation_logs
       WHERE table_name = 'file_refs' AND record_id = ?`,
      [file!.file_ref_id],
    )

    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs)).not.toMatch(
      /SECRET-TAX|SECRET-PATH|敏感经办人|file_name|file_path|uploader/,
    )
    expect(JSON.parse(logs[0]!.after_data)).toMatchObject({
      id: file!.file_ref_id,
      owner_type: 'supplier_credential',
      owner_id: id,
    })
  })

  it('新增入口忽略越界 OCR 正文，并且只写脱敏专用审计', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')
    const id = await detailStore.addCredential({
      supplierId: 's1',
      category: '完税证明',
      file: { fileName: '完税证明.pdf', payloadBase64: 'AQ==' },
      ocrResult: { taxNo: 'SHOULD-NOT-PERSIST' },
      ocrConfirmedResult: { bankAccount: 'ACCOUNT-SHOULD-NOT-PERSIST' },
    } as Parameters<typeof detailStore.addCredential>[0])

    expect(await mem.select(
      `SELECT ocr_result, ocr_confirmed_result, ocr_confirmed_at
       FROM supplier_credentials WHERE id = ?`,
      [id],
    )).toEqual([{
      ocr_result: '{}',
      ocr_confirmed_result: '{}',
      ocr_confirmed_at: null,
    }])
    expect(JSON.stringify(await mem.select(
      `SELECT before_data, after_data FROM operation_logs`,
    ))).not.toMatch(/SHOULD-NOT-PERSIST|ACCOUNT-SHOULD-NOT-PERSIST/)
    expect(await mem.select(
      `SELECT action, changed_fields
       FROM supplier_credential_audits WHERE credential_id = ?`,
      [id],
    )).toEqual([{
      action: 'credential_create',
      changed_fields: '["credential","file_ref"]',
    }])
  })

  it('人工合格/退回需要凭证，关键资料变化使结论失效，可选资料变化不撤销合格', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '基本存款账户信息',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })

    expect(supplierStore.byId('s1')?.credentialStatus).toBe('reviewing')
    await detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'qualified',
      note: '人工核验通过',
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')
    expect(supplierStore.byId('s1')?.credentialReviewedAt).toBeTruthy()
    expect(await mem.select(`
      SELECT action, outcome, source_category, changed_fields, note_present
      FROM supplier_audits
      WHERE supplier_id = 's1' AND action = 'credential_review'
    `)).toEqual([{
      action: 'credential_review',
      outcome: 'qualified',
      source_category: 'manual',
      changed_fields: '["credential_review_note","credential_reviewed_at","credential_status"]',
      note_present: 1,
    }])
    expect(JSON.stringify(await mem.select(`
      SELECT before_data, after_data
      FROM operation_logs WHERE table_name = 'suppliers'
    `))).not.toContain('人工核验通过')

    await detailStore.addCredential({
      supplierId: 's1',
      category: '完税证明',
      file: { fileName: '完税证明.pdf', payloadBase64: 'AQ==' },
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')

    await detailStore.updateCredentialRequirement({
      supplierId: 's1',
      category: '资质证书',
      requirement: 'required',
      reason: '专业合同要求',
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('incomplete')
    expect(supplierStore.byId('s1')?.credentialReviewedAt).toBeNull()

    await detailStore.addCredential({
      supplierId: 's1',
      category: '资质证书',
      file: { fileName: '资质证书.pdf', payloadBase64: 'AQ==' },
    })
    await expect(detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'rejected',
      note: '',
    })).rejects.toThrow('人工退回必须填写原因')
    await detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'rejected',
      note: '扫描件模糊',
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('rejected')
    expect(supplierStore.byId('s1')?.credentialReviewNote).toBe('扫描件模糊')
  })

  it('oCR 成功立即持久化待核对，重载后可继续确认且保留原始值与确认值', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')

    const rawOcrResult = {
      name: 'OCR 候选公司',
      taxNo: 'OCR-CANDIDATE',
      bankAccount: 'OCR-ACCOUNT-SECRET',
    }
    await detailStore.recordCredentialOcrRecognition({
      supplierId: 's1',
      credentialId: 'cred1',
      rawOcrResult,
      confidence: 0.91,
    })
    expect(detailStore.bySupplier('s1').credentials.find(row => row.id === 'cred1'))
      .toMatchObject({
        ocrResult: rawOcrResult,
        ocrConfidence: 0.91,
        ocrReviewStatus: 'pending',
        ocrConfirmedAt: null,
      })

    await detailStore.load('s1')
    expect(detailStore.bySupplier('s1').credentials.find(row => row.id === 'cred1'))
      .toMatchObject({
        ocrResult: rawOcrResult,
        ocrReviewStatus: 'pending',
      })

    await detailStore.updateCredentialReview({
      supplierId: 's1',
      credentialId: 'cred1',
      category: '营业执照',
      confirmedFields: {
        name: '人工确认公司',
        taxNo: 'CONFIRMED-TAX',
        bankAccount: 'CONFIRMED-ACCOUNT',
      },
      validFrom: '2026-01-01',
      expiresAt: '2036-01-01',
      supplierFields: {
        name: '人工确认公司',
        taxNo: 'CONFIRMED-TAX',
        bank: '测试银行',
        bankAccount: 'CONFIRMED-ACCOUNT',
      },
    })

    expect(detailStore.bySupplier('s1').credentials.find(row => row.id === 'cred1')).toMatchObject({
      category: '营业执照',
      ocrResult: {
        name: 'OCR 候选公司',
        taxNo: 'OCR-CANDIDATE',
      },
      ocrConfirmedResult: {
        name: '人工确认公司',
        taxNo: 'CONFIRMED-TAX',
      },
      ocrConfidence: 0.91,
      ocrReviewStatus: 'confirmed',
      ocrConfirmedAt: expect.any(String),
      validFrom: '2026-01-01',
      expiresAt: '2036-01-01',
    })
    expect(supplierStore.byId('s1')).toMatchObject({
      name: '人工确认公司',
      taxNo: 'CONFIRMED-TAX',
    })
    const operationLogs = await mem.select<{ before_data: string, after_data: string }>(
      `SELECT before_data, after_data FROM operation_logs`,
    )
    expect(JSON.stringify(operationLogs)).not.toMatch(
      /OCR-CANDIDATE|OCR-ACCOUNT-SECRET|CONFIRMED-TAX|CONFIRMED-ACCOUNT/,
    )
    expect(await mem.select(`
      SELECT action, changed_fields, category_before, category_after, confidence
      FROM supplier_credential_audits
      WHERE credential_id = 'cred1'
      ORDER BY rowid
    `)).toEqual([
      {
        action: 'ocr_recognition',
        changed_fields: JSON.stringify([
          'ocr_result',
          'ocr_confidence',
          'ocr_review_status',
        ]),
        category_before: '营业执照',
        category_after: '营业执照',
        confidence: 0.91,
      },
      {
        action: 'ocr_review',
        changed_fields: JSON.stringify([
          'category',
          'ocr_confirmed_result',
          'ocr_review_status',
          'validity',
          'supplier.name',
          'supplier.taxNo',
          'supplier.bank',
          'supplier.bankAccount',
        ]),
        category_before: '营业执照',
        category_after: '营业执照',
        confidence: 0.91,
      },
    ])

    const deleteAuditId = await detailStore.removeCredential('cred1', 's1')
    expect(deleteAuditId).toBeTruthy()
    expect(JSON.stringify(await mem.select(
      `SELECT before_data, after_data FROM operation_logs`,
    ))).not.toMatch(
      /OCR-CANDIDATE|OCR-ACCOUNT-SECRET|CONFIRMED-TAX|CONFIRMED-ACCOUNT/,
    )
    expect(await mem.select(
      `SELECT action, changed_fields
       FROM supplier_credential_audits
       WHERE id = ?`,
      [deleteAuditId],
    )).toEqual([{
      action: 'credential_delete',
      changed_fields: '["deleted_at"]',
    }])
    await expect(detailStore.undoCredential(deleteAuditId!, 's1')).resolves.toBe(true)
  })

  it('重跑 OCR 的 pending 与无业务变化确认保留人工合格，确认业务变更后才失效', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })
    await detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'qualified',
      note: '人工核验通过',
    })

    await detailStore.recordCredentialOcrRecognition({
      supplierId: 's1',
      credentialId: 'cred1',
      rawOcrResult: { markdownPages: ['候选一'] },
      confidence: 0.8,
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')

    await detailStore.updateCredentialReview({
      supplierId: 's1',
      credentialId: 'cred1',
      category: '营业执照',
      confirmedFields: { decisions: { category: 'keep-current' } },
      validFrom: '',
      expiresAt: '',
      longTerm: false,
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')

    const confirmedBefore = detailStore.bySupplier('s1').credentials.find(
      row => row.id === 'cred1',
    )!
    await detailStore.recordCredentialOcrRecognition({
      supplierId: 's1',
      credentialId: 'cred1',
      rawOcrResult: { markdownPages: ['候选二'] },
      confidence: 0.9,
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')
    expect(detailStore.bySupplier('s1').credentials.find(row => row.id === 'cred1'))
      .toMatchObject({
        ocrReviewStatus: 'pending',
        ocrConfirmedAt: confirmedBefore.ocrConfirmedAt,
        ocrConfirmedResult: confirmedBefore.ocrConfirmedResult,
      })

    await detailStore.updateCredentialReview({
      supplierId: 's1',
      credentialId: 'cred1',
      category: '营业执照',
      confirmedFields: { name: '新公司', decisions: { name: 'use-recognized' } },
      validFrom: '',
      expiresAt: '',
      longTerm: false,
      supplierFields: { name: '新公司' },
    })
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('reviewing')
  })

  it('重复保存相同有效期和条件资料要求不撤销人工合格', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })
    await detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'qualified',
      note: '人工核验通过',
    })

    await detailStore.updateCredentialValidity({
      supplierId: 's1',
      credentialId: 'cred1',
      validFrom: '',
      expiresAt: '',
      longTerm: false,
    })
    await detailStore.updateCredentialRequirement({
      supplierId: 's1',
      category: '资质证书',
      requirement: 'optional',
      reason: '',
    })

    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')
  })

  it('数据层拒绝把固定必需资料降级，也拒绝从资料不全直接退回', async () => {
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')

    await expect(detailStore.updateCredentialRequirement({
      supplierId: 's1',
      category: '营业执照',
      requirement: 'optional',
    })).rejects.toThrow('营业执照是固定必需资料')
    await expect(detailStore.updateCredentialRequirement({
      supplierId: 's1',
      category: '法人身份证',
      requirement: 'not_applicable',
    })).rejects.toThrow('法人身份证是固定必需资料')
    await expect(detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'rejected',
      note: '资料缺失',
    })).rejects.toThrow('只有资料齐全待核验时才能人工退回')
  })

  it('手工有效期更新不伪造 OCR 确认，并使必需资料人工结论失效', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })
    await detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'qualified',
      note: '人工核验通过',
    })

    await detailStore.updateCredentialValidity({
      supplierId: 's1',
      credentialId: 'cred1',
      validFrom: '2020-01-01',
      expiresAt: '2020-12-31',
      longTerm: false,
    })

    expect(detailStore.bySupplier('s1').credentials.find(row => row.id === 'cred1'))
      .toMatchObject({
        validFrom: '2020-01-01',
        expiresAt: '2020-12-31',
        longTerm: false,
        ocrConfirmedAt: null,
      })
    expect(supplierStore.byId('s1')).toMatchObject({
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
    })
    expect(await mem.select(`
      SELECT action, valid_from_before, valid_from_after,
             expires_at_before, expires_at_after
      FROM supplier_credential_audits
      WHERE credential_id = 'cred1'
    `)).toEqual([{
      action: 'validity_update',
      valid_from_before: '',
      valid_from_after: '2020-01-01',
      expires_at_before: '',
      expires_at_after: '2020-12-31',
    }])
  })

  it('旧 qualified 没有供应商级人工凭证时在读取时重算，有凭证时保留', async () => {
    await mem.execute(`
      INSERT INTO supplier_credentials (id, supplier_id, category, file_name, file_path)
      VALUES ('cred-bank', 's1', '银行账户资料', '账户资料.pdf', 'C:\\legacy\\账户资料.pdf')
    `)
    await mem.execute(`
      UPDATE suppliers
      SET credential_status = 'qualified',
          credential_reviewed_at = NULL,
          credential_review_note = ''
      WHERE id = 's1'
    `)
    const detailStore = useSupplierDetailStore()
    const supplierStore = useSupplierStore()
    await detailStore.load('s1')
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('incomplete')

    await mem.execute(`
      INSERT INTO file_refs (
        id, owner_type, owner_id, file_name, file_path, mime_type, category
      )
      VALUES (
        'file-cred-bank', 'supplier_credential', 'cred-bank',
        '账户资料.pdf', 'C:\\legacy\\账户资料.pdf', 'application/pdf', '银行账户资料'
      )
    `)
    await mem.execute(`
      UPDATE supplier_credentials SET file_ref_id = 'file-cred-bank'
      WHERE id = 'cred-bank'
    `)
    await mem.execute(`
      INSERT INTO file_payloads (file_ref_id, encoding, content)
      VALUES ('file-cred-bank', 'base64', 'AQ==')
    `)
    await detailStore.load('s1')
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('reviewing')

    await mem.execute(`
      UPDATE suppliers
      SET credential_status = 'qualified',
          credential_reviewed_at = '2026-07-30T09:00:00.000Z'
      WHERE id = 's1'
    `)
    await supplierStore.load()
    await detailStore.load('s1')
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')
  })

  it('列表 load 跨上海业务日使已过期的 qualified 失效，未到期时保留', async () => {
    const detailStore = useSupplierDetailStore()
    const supplierStore = useSupplierStore()
    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })
    await mem.execute(`
      UPDATE supplier_credentials
      SET expires_at = '2026-07-30'
      WHERE id = 'cred1'
    `)
    await mem.execute(`
      UPDATE suppliers
      SET credential_status = 'qualified',
          credential_reviewed_at = '2026-07-30T08:00:00.000Z',
          credential_review_note = '当日有效'
      WHERE id = 's1'
    `)

    await supplierStore.load('2026-07-30')
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('qualified')
    await supplierStore.load('2026-07-31')
    expect(supplierStore.byId('s1')).toMatchObject({
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })
  })

  it('列表 load 会让跨日过期的自动 reviewing 降为 incomplete', async () => {
    const detailStore = useSupplierDetailStore()
    const supplierStore = useSupplierStore()
    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })
    await mem.execute(`
      UPDATE supplier_credentials
      SET expires_at = '2026-07-30'
      WHERE id = 'cred1'
    `)
    await mem.execute(`
      UPDATE suppliers
      SET credential_status = 'reviewing',
          credential_reviewed_at = NULL,
          credential_review_note = ''
      WHERE id = 's1'
    `)

    await supplierStore.load('2026-07-30')
    expect(supplierStore.byId('s1')?.credentialStatus).toBe('reviewing')
    await supplierStore.load('2026-07-31')
    expect(supplierStore.byId('s1')).toMatchObject({
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })
  })

  it('人工退回在必需文件过期或正文丢失后自动降为 incomplete', async () => {
    const detailStore = useSupplierDetailStore()
    const supplierStore = useSupplierStore()
    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })
    await detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'rejected',
      note: '内容需整改',
    })
    await mem.execute(`
      UPDATE supplier_credentials SET expires_at = '2026-07-30'
      WHERE id = 'cred1'
    `)

    await supplierStore.load('2026-07-31')
    expect(supplierStore.byId('s1')).toMatchObject({
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })

    await mem.execute(`
      UPDATE supplier_credentials SET expires_at = ''
      WHERE id = 'cred1'
    `)
    await mem.execute(`
      UPDATE suppliers
      SET credential_status = 'rejected',
          credential_reviewed_at = '2026-07-31T08:00:00.000Z',
          credential_review_note = '内容需整改'
      WHERE id = 's1'
    `)
    await mem.execute(`DELETE FROM file_payloads WHERE file_ref_id = 'file-cred1'`)
    await detailStore.load('s1')
    expect(supplierStore.byId('s1')).toMatchObject({
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })
  })

  it('供应商公开写入口不能越权制造人工结论，关键字段变化由触发器统一失效', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    const createdId = await supplierStore.add({
      name: '敏感信息分供方',
      taxNo: 'ADD-SECRET-TAX',
      bankAccount: 'ADD-SECRET-ACCOUNT',
      credentialStatus: 'qualified',
      credentialReviewedAt: '2026-07-30T08:00:00.000Z',
      credentialReviewNote: '越权通过',
    })
    expect(supplierStore.byId(createdId)).toMatchObject({
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })
    await supplierStore.update(createdId, {
      taxNo: 'UPDATE-SECRET-TAX',
      bankAccount: 'UPDATE-SECRET-ACCOUNT',
      credentialStatus: 'qualified',
      credentialReviewedAt: '2026-07-30T09:00:00.000Z',
      credentialReviewNote: '再次越权',
    })
    expect(supplierStore.byId(createdId)).toMatchObject({
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })
    expect(JSON.stringify(await mem.select(`
      SELECT before_data, after_data
      FROM operation_logs WHERE table_name = 'suppliers'
    `))).not.toMatch(/SECRET|越权/)

    await detailStore.load('s1')
    await detailStore.addCredential({
      supplierId: 's1',
      category: '银行账户资料',
      file: { fileName: '账户资料.pdf', payloadBase64: 'AQ==' },
    })
    await detailStore.reviewCredentials({
      supplierId: 's1',
      decision: 'qualified',
      note: '人工通过',
    })
    const current = supplierStore.byId('s1')!
    await supplierStore.update('s1', {
      ...current,
      name: '关键工商信息已变化',
    })
    expect(supplierStore.byId('s1')).toMatchObject({
      credentialStatus: 'reviewing',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })

    const deleteAuditId = await supplierStore.remove(createdId)
    expect(deleteAuditId).toBeTruthy()
    expect(supplierStore.byId(createdId)).toBeUndefined()
    expect(await mem.select(`
      SELECT id FROM operation_logs
      WHERE table_name = 'suppliers' AND record_id = ?
    `, [createdId])).toEqual([])
    await expect(supplierStore.undo(deleteAuditId!)).resolves.toBe(true)
    expect(supplierStore.byId(createdId)?.name).toBe('敏感信息分供方')

    const importedId = await supplierStore.upsertImported({
      externalRef: 'IMPORT-SENSITIVE-001',
      name: '导入分供方',
      taxNo: 'IMPORT-SECRET-TAX',
      bankAccount: 'IMPORT-SECRET-ACCOUNT',
      credentialStatus: 'qualified',
      credentialReviewedAt: '2026-07-30T10:00:00.000Z',
      credentialReviewNote: '导入越权',
    })
    await supplierStore.upsertImported({
      externalRef: 'IMPORT-SENSITIVE-001',
      name: '导入分供方更新',
      taxNo: 'IMPORT-SECRET-TAX-UPDATED',
      credentialStatus: 'qualified',
    })
    expect(supplierStore.byId(importedId)).toMatchObject({
      name: '导入分供方更新',
      credentialStatus: 'incomplete',
      credentialReviewedAt: null,
      credentialReviewNote: '',
    })
    expect(await mem.select(`
      SELECT action, source_category
      FROM supplier_audits
      WHERE supplier_id = ?
      ORDER BY created_at, rowid
    `, [importedId])).toEqual([
      { action: 'create', source_category: 'import' },
      { action: 'update', source_category: 'import' },
    ])
    expect(JSON.stringify(await mem.select(`
      SELECT before_data, after_data
      FROM operation_logs WHERE table_name = 'suppliers'
    `))).not.toContain('IMPORT-SECRET')
  })

  it('税务官网未查到只保存待确认，不自动推导为小规模纳税人', async () => {
    const supplierStore = useSupplierStore()
    const detailStore = useSupplierDetailStore()
    const result = await detailStore.recordTaxpayerVerification({
      supplierId: 's1',
      status: 'not_found',
      source: 'https://etax.guangdong.chinatax.gov.cn/',
      taxpayerType: '小规模纳税人',
      note: '官网未查到',
    })
    expect(result).toEqual({
      status: 'not_found',
      taxpayerType: '未核验',
      source: 'https://etax.guangdong.chinatax.gov.cn/',
      verifiedAt: expect.any(String),
      note: '官网未查到',
    })
    expect(supplierStore.byId('s1')).toMatchObject({
      taxpayerType: '未核验',
      taxpayerVerificationStatus: 'not_found',
      taxpayerVerificationNote: '官网未查到',
    })
    expect(await mem.select(`
      SELECT action, outcome, source_category, changed_fields, note_present
      FROM supplier_audits
      WHERE supplier_id = 's1' AND action = 'taxpayer_verification'
    `)).toEqual([{
      action: 'taxpayer_verification',
      outcome: 'not_found',
      source_category: 'official_website',
      changed_fields: JSON.stringify([
        'taxpayer_type',
        'taxpayer_verification_note',
        'taxpayer_verification_source',
        'taxpayer_verification_status',
        'taxpayer_verified_at',
      ]),
      note_present: 1,
    }])
    expect(JSON.stringify(await mem.select(`
      SELECT before_data, after_data
      FROM operation_logs WHERE table_name = 'suppliers'
    `))).not.toContain('官网未查到')
  })
})
