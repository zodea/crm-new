import type { SupplierCredential, SupplierDetailSnapshot } from '~/stores/supplier-detail'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SupplierCredentialTab from '~/components/supplier/SupplierCredentialTab.vue'

const recognizeDocument = vi.hoisted(() => vi.fn())
const loadFileRefContent = vi.hoisted(() => vi.fn())

vi.mock('~/lib/recognize/engine', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/lib/recognize/engine')>()
  return { ...original, recognizeDocument }
})

vi.mock('~/lib/forms/file-refs', async (importOriginal) => {
  const original = await importOriginal<typeof import('~/lib/forms/file-refs')>()
  return { ...original, loadFileRefContent }
})

function snapshot(credentials: SupplierCredential[] = []): SupplierDetailSnapshot {
  return {
    credentials,
    requirements: [],
    projects: [],
    contracts: [],
    payments: [],
    invoices: [],
    summary: {
      projectCount: 0,
      contractCount: 0,
      contractTotal: 0,
      claimedTotal: 0,
      invoiceTotal: 0,
      invoiceTaxTotal: 0,
      paidTotal: 0,
      payableBalance: 0,
    },
  }
}

function credential(overrides: Partial<SupplierCredential> = {}): SupplierCredential {
  return {
    id: 'cred-existing',
    supplierId: 'supplier-1',
    category: '资质证书',
    fileName: '合成资质证书.pdf',
    filePath: 'D:\\资料\\合成资质证书.pdf',
    fileRefId: 'file-ref-1',
    fileRef: {
      id: 'file-ref-1',
      ownerType: 'supplier_credential',
      ownerId: 'cred-existing',
      fileName: '合成资质证书.pdf',
      filePath: 'D:\\资料\\合成资质证书.pdf',
      fileSize: 321,
      mimeType: 'application/pdf',
      category: '资质证书',
      uploader: '当前用户',
      uploadedAt: '2026-07-30T10:00:00.000Z',
      deletedAt: null,
    },
    fileSize: 321,
    mimeType: 'application/pdf',
    hasAccessibleFile: true,
    validFrom: '',
    expiresAt: '',
    longTerm: false,
    ocrResult: {},
    ocrConfidence: null,
    ocrConfirmedResult: {},
    ocrConfirmedAt: null,
    ocrReviewStatus: 'not_started',
    verifiedAt: null,
    addedAt: '2026-07-30T16:20:30.000Z',
    ...overrides,
  }
}

function ocrResult() {
  const markdown = `
    营业执照
    名称：OCR 公司
    统一社会信用代码：91440000TEST123456
    法定代表人：张某
  `
  return {
    engine: 'paddleocr-official-api',
    model: 'PaddleOCR-VL-1.6',
    jobId: 'synthetic-job',
    pages: [{ pageIndex: 0, markdown, prunedResult: {}, layoutRegions: [] }],
    markdownPages: [markdown],
    dataInfo: {},
  }
}

function pdfFile(name: string): File {
  return new File(['%PDF-1.7 synthetic'], name, { type: 'application/pdf' })
}

function pngFile(name: string): File {
  return new File([
    new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  ], name, { type: 'image/png' })
}

function setup(
  snapshotValue = snapshot(),
  supplierStatus: 'incomplete' | 'reviewing' | 'qualified' | 'rejected' = 'reviewing',
) {
  const addCredentials = vi.fn().mockResolvedValue(['cred-1'])
  const load = vi.fn().mockResolvedValue(undefined)
  const recordCredentialOcrRecognition = vi.fn().mockResolvedValue(undefined)
  const updateCredentialReview = vi.fn().mockResolvedValue(undefined)
  const updateCredentialValidity = vi.fn().mockResolvedValue(undefined)
  const updateCredentialRequirement = vi.fn().mockResolvedValue(undefined)
  const reviewCredentials = vi.fn().mockResolvedValue(undefined)
  const removeCredential = vi.fn()
  const undoCredential = vi.fn()
  const messages = {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }
  const formModal = vi.fn()
  const preview = vi.fn()
  const download = vi.fn()
  vi.stubGlobal('useSupplierDetailStore', () => ({
    addCredentials,
    load,
    recordCredentialOcrRecognition,
    updateCredentialReview,
    updateCredentialValidity,
    updateCredentialRequirement,
    reviewCredentials,
    removeCredential,
    undoCredential,
  }))
  vi.stubGlobal('useSupplierStore', () => ({
    byId: () => ({
      id: 'supplier-1',
      name: '当前公司',
      uniqueCode: '',
      taxNo: '',
      legalRep: '',
      address: '',
      bank: '',
      bankAccount: '',
      credentialStatus: supplierStatus,
      credentialReviewedAt: null,
      credentialReviewNote: '',
    }),
  }))
  vi.stubGlobal('useKitUI', () => ({
    confirm: vi.fn(),
    formModal,
    undoToast: vi.fn(),
    ...messages,
  }))
  vi.stubGlobal('useFileRefAccess', () => ({
    preview,
    download,
  }))

  const view = render(SupplierCredentialTab, {
    props: {
      supplierId: 'supplier-1',
      snapshot: snapshotValue,
    },
  })
  return {
    ...view,
    addCredentials,
    load,
    recordCredentialOcrRecognition,
    updateCredentialReview,
    updateCredentialValidity,
    formModal,
    preview,
    messages,
  }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('supplier credential tab', () => {
  it('只有齐全待核验状态允许人工退回', () => {
    setup(snapshot(), 'qualified')

    const rejectButton = screen.getByRole('button', { name: '退回整改' }) as HTMLButtonElement
    expect(rejectButton.disabled).toBe(true)
    expect(rejectButton.title).toBe('仅齐全待核验状态可以人工退回')
  })

  it('上传前拒绝伪装类型和超过 20MB 的证照，不写入数据层', async () => {
    const { addCredentials, messages } = setup()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const disguised = new File(['not a pdf'], '伪装证照.pdf', {
      type: 'application/pdf',
    })
    await fireEvent.change(input, { target: { files: [disguised] } })
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith(
      expect.stringContaining('文件内容与扩展名不匹配'),
    ))

    const oversized = pdfFile('超大证照.pdf')
    Object.defineProperty(oversized, 'size', { value: 20 * 1024 * 1024 + 1 })
    await fireEvent.change(input, { target: { files: [oversized] } })
    await waitFor(() => expect(messages.error).toHaveBeenCalledWith(
      expect.stringContaining('不能超过 20 MB'),
    ))
    expect(addCredentials).not.toHaveBeenCalled()
  })

  it('多文件 input 保存真实 payload，并对首份文件启动真实 OCR 核对', async () => {
    recognizeDocument.mockResolvedValue(ocrResult())
    const { addCredentials, recordCredentialOcrRecognition } = setup()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const files = [
      pdfFile('合成营业执照.pdf'),
      pngFile('合成银行资料.png'),
    ]

    await fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(addCredentials).toHaveBeenCalledOnce())
    expect(addCredentials.mock.calls[0]?.[0]).toMatchObject({
      supplierId: 'supplier-1',
      category: '营业执照',
      files: [
        expect.objectContaining({
          fileName: '合成营业执照.pdf',
          mimeType: 'application/pdf',
          payloadBase64: expect.any(String),
        }),
        expect.objectContaining({
          fileName: '合成银行资料.png',
          mimeType: 'image/png',
          payloadBase64: expect.any(String),
        }),
      ],
    })
    await waitFor(() => expect(screen.getByText('核对 OCR 识别结果')).not.toBeNull())
    expect(recognizeDocument).toHaveBeenCalledWith(files[0], expect.objectContaining({
      onProgress: expect.any(Function),
    }))
    expect(recordCredentialOcrRecognition).toHaveBeenCalledWith({
      supplierId: 'supplier-1',
      credentialId: 'cred-1',
      rawOcrResult: expect.objectContaining({ model: 'PaddleOCR-VL-1.6' }),
      confidence: expect.any(Number),
    })
    expect(screen.getByText('存在冲突')).not.toBeNull()
  })

  it('批量队列首份识别失败后继续处理下一份', async () => {
    recognizeDocument
      .mockRejectedValueOnce(new Error('首份识别失败'))
      .mockResolvedValueOnce(ocrResult())
    const { addCredentials, messages } = setup()
    addCredentials.mockResolvedValue(['cred-1', 'cred-2'])
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    const files = [
      pdfFile('无法识别.pdf'),
      pdfFile('第二份营业执照.pdf'),
    ]

    await fireEvent.change(input, { target: { files } })

    await waitFor(() => expect(recognizeDocument).toHaveBeenCalledTimes(2))
    expect(recognizeDocument.mock.calls.map(call => (call[0] as File).name))
      .toEqual(['无法识别.pdf', '第二份营业执照.pdf'])
    expect(messages.error).toHaveBeenCalledWith(expect.stringContaining('首份识别失败'))
    await waitFor(() => expect(screen.getByText('第二份营业执照.pdf · PaddleOCR-VL 1.6')).not.toBeNull())
  })

  it('确认 OCR 后分别提交原始结果、人工决策和最终字段', async () => {
    recognizeDocument.mockResolvedValue(ocrResult())
    const { recordCredentialOcrRecognition, updateCredentialReview } = setup()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await fireEvent.change(input, {
      target: {
        files: [pdfFile('合成营业执照.pdf')],
      },
    })
    await waitFor(() => expect(screen.getByRole('button', { name: '保存核对结果' })).not.toBeNull())

    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))

    await waitFor(() => expect(updateCredentialReview).toHaveBeenCalledOnce())
    expect(recordCredentialOcrRecognition).toHaveBeenCalledOnce()
    expect(updateCredentialReview.mock.calls[0]?.[0]).toMatchObject({
      supplierId: 'supplier-1',
      credentialId: 'cred-1',
      category: '营业执照',
      confirmedFields: expect.objectContaining({
        name: '当前公司',
        uniqueCode: '91440000TEST123456',
        decisions: expect.objectContaining({
          name: 'keep-current',
          uniqueCode: 'use-recognized',
        }),
        sourceFile: '合成营业执照.pdf',
      }),
      supplierFields: {
        uniqueCode: '91440000TEST123456',
        legalRep: '张某',
      },
    })
  })

  it('稍后核对后重载仍为待核对，并可直接继续而不重复识别文件', async () => {
    const rawResult = ocrResult()
    recognizeDocument.mockResolvedValue(rawResult)
    const first = setup()
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await fireEvent.change(input, {
      target: {
        files: [pdfFile('合成营业执照.pdf')],
      },
    })
    await screen.findByRole('button', { name: '稍后核对' })
    await waitFor(() => expect(first.recordCredentialOcrRecognition).toHaveBeenCalledOnce())
    await fireEvent.click(screen.getByRole('button', { name: '稍后核对' }))
    first.unmount()

    const pending = credential({
      ocrResult: rawResult,
      ocrConfidence: 0.87,
      ocrReviewStatus: 'pending',
    })
    const second = setup(snapshot([pending]))
    expect(screen.getByText('待核对')).not.toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: '继续核对 合成资质证书.pdf' }))
    await screen.findByRole('region', { name: '核对 OCR 识别结果' })
    expect(recognizeDocument).toHaveBeenCalledTimes(1)
    expect(loadFileRefContent).not.toHaveBeenCalled()

    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    await waitFor(() => expect(second.updateCredentialReview).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'cred-existing',
        category: '资质证书',
        confirmedFields: expect.objectContaining({
          decisions: expect.objectContaining({
            category: 'keep-current',
          }),
        }),
      }),
    ))
  })

  it('当前类别与 OCR 建议冲突时直接保存仍保留当前类别', async () => {
    const existing = credential({ category: '资质证书' })
    recognizeDocument.mockResolvedValue(ocrResult())
    loadFileRefContent.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    })
    const { updateCredentialReview } = setup(snapshot([existing]))

    await fireEvent.click(screen.getByRole('button', { name: 'OCR 识别 合成资质证书.pdf' }))
    await screen.findByText('类别存在冲突')
    expect(screen.getByText('当前：资质证书')).not.toBeNull()
    expect(screen.getByText('OCR 建议：营业执照')).not.toBeNull()
    expect((screen.getByRole('radio', { name: '保留当前类别' }) as HTMLInputElement).checked)
      .toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))
    await waitFor(() => expect(updateCredentialReview).toHaveBeenCalledWith(
      expect.objectContaining({
        category: '资质证书',
        confirmedFields: expect.objectContaining({
          decisions: expect.objectContaining({ category: 'keep-current' }),
        }),
      }),
    ))
  })

  it('旧格式待核对结果无法解析时从原文件重新识别，不会永久卡住', async () => {
    const legacyPending = credential({
      ocrResult: { text: '旧版 OCR 文本' },
      ocrReviewStatus: 'pending',
    })
    recognizeDocument.mockResolvedValue(ocrResult())
    loadFileRefContent.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    })
    const { messages, recordCredentialOcrRecognition } = setup(snapshot([legacyPending]))

    await fireEvent.click(screen.getByRole('button', { name: '继续核对 合成资质证书.pdf' }))

    await screen.findByRole('region', { name: '核对 OCR 识别结果' })
    expect(messages.warning).toHaveBeenCalledWith(expect.stringContaining('旧格式'))
    expect(loadFileRefContent).toHaveBeenCalledOnce()
    expect(recognizeDocument).toHaveBeenCalledOnce()
    expect(recordCredentialOcrRecognition).toHaveBeenCalledOnce()
  })

  it('核对区出现后接收焦点，取消后返回上传按钮', async () => {
    recognizeDocument.mockResolvedValue(ocrResult())
    setup()
    const uploadButton = screen.getByRole('button', { name: '上传并识别' })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!

    await fireEvent.change(input, {
      target: {
        files: [pdfFile('聚焦测试营业执照.pdf')],
      },
    })

    const reviewRegion = await screen.findByRole('region', { name: '核对 OCR 识别结果' })
    await waitFor(() => expect(document.activeElement).toBe(reviewRegion))
    expect(reviewRegion.getAttribute('aria-describedby')).toBe('credential-ocr-guidance')

    await fireEvent.click(screen.getByRole('button', { name: '稍后核对' }))
    await waitFor(() => expect(document.activeElement).toBe(uploadButton))
  })

  it('预览使用 snapshot 返回的真实文件 MIME、大小与路径', async () => {
    const existing = credential()
    const { preview } = setup(snapshot([existing]))

    await fireEvent.click(screen.getByRole('button', { name: '预览 合成资质证书.pdf' }))

    expect(preview).toHaveBeenCalledWith(existing.fileRef)
    expect(preview.mock.calls[0]?.[0]).toMatchObject({
      filePath: 'D:\\资料\\合成资质证书.pdf',
      fileSize: 321,
      mimeType: 'application/pdf',
    })
    expect(screen.getByText('2026-07-31 00:20:30')).not.toBeNull()
  })

  it('legacy 路径不读取也不刷新，明确提示重新上传原件', async () => {
    const legacy = credential({ hasAccessibleFile: false })
    const { load, messages, preview } = setup(snapshot([legacy]))

    await fireEvent.click(screen.getByRole('button', { name: '预览 合成资质证书.pdf' }))
    await fireEvent.click(screen.getByRole('button', { name: 'OCR 识别 合成资质证书.pdf' }))

    expect(preview).not.toHaveBeenCalled()
    expect(loadFileRefContent).not.toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(messages.warning).toHaveBeenCalledTimes(2)
    expect(messages.warning).toHaveBeenNthCalledWith(
      1,
      '历史证照未保存原件，旧路径不会被读取，请重新上传原文件',
    )
    expect(messages.warning).toHaveBeenNthCalledWith(
      2,
      '历史证照未保存原件，旧路径不会被读取，请重新上传原文件',
    )
  })

  it('只有文件名而没有可访问原件的必需资料仍显示为缺失', () => {
    const inaccessibleLicense = credential({
      category: '营业执照',
      fileName: '仅元数据营业执照.pdf',
      fileRefId: null,
      fileRef: null,
      hasAccessibleFile: false,
    })
    setup(snapshot([inaccessibleLicense]))

    const missingStatus = screen.getByRole('status')
    expect(missingStatus.textContent).toContain('营业执照')
    expect(missingStatus.textContent).toContain('法人身份证')
    expect(missingStatus.textContent).toContain('银行账户资料')
  })

  it('识别失败后仍可从文件行人工补录有效期', async () => {
    const { formModal, updateCredentialValidity } = setup(snapshot([credential()]))
    formModal.mockResolvedValue({
      validFrom: '2026-01-01',
      validityType: '长期有效',
      expiresAt: '2027-01-01',
    })

    await fireEvent.click(screen.getByRole('button', { name: '编辑有效期 合成资质证书.pdf' }))

    await waitFor(() => expect(updateCredentialValidity).toHaveBeenCalledWith({
      supplierId: 'supplier-1',
      credentialId: 'cred-existing',
      validFrom: '2026-01-01',
      expiresAt: '',
      longTerm: true,
    }))
  })

  it('已有日期但本次识别无日期时默认保留原值', async () => {
    const existing = {
      ...credential(),
      validFrom: '2022-01-01',
      expiresAt: '2032-01-01',
    }
    recognizeDocument.mockResolvedValue(ocrResult())
    loadFileRefContent.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    })
    const { updateCredentialReview } = setup(snapshot([existing]))

    await fireEvent.click(screen.getByRole('button', { name: 'OCR 识别 合成资质证书.pdf' }))
    const validFromGroup = await screen.findByRole('group', { name: '生效日期' })
    const expiresAtGroup = screen.getByRole('group', { name: '到期日期' })
    expect((within(validFromGroup).getByRole('radio', { name: '保留当前值' }) as HTMLInputElement).checked).toBe(true)
    expect((within(expiresAtGroup).getByRole('radio', { name: '保留当前值' }) as HTMLInputElement).checked).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))

    await waitFor(() => expect(updateCredentialReview).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'cred-existing',
        validFrom: '2022-01-01',
        expiresAt: '2032-01-01',
        confirmedFields: expect.objectContaining({
          validFrom: '2022-01-01',
          expiresAt: '2032-01-01',
        }),
      }),
    ))
  })

  it('旧证照长期有效但本次识别无期限时仍默认保留', async () => {
    const existing = {
      ...credential(),
      longTerm: true,
      expiresAt: '',
    }
    recognizeDocument.mockResolvedValue(ocrResult())
    loadFileRefContent.mockResolvedValue({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'application/pdf',
    })
    const { updateCredentialReview } = setup(snapshot([existing]))

    await fireEvent.click(screen.getByRole('button', { name: 'OCR 识别 合成资质证书.pdf' }))
    const longTermGroup = await screen.findByRole('group', { name: '长期有效状态' })
    expect(longTermGroup.textContent).toContain('当前：长期有效')
    expect(longTermGroup.textContent).toContain('OCR：未识别')
    expect((within(longTermGroup).getByRole('radio', { name: '保留当前状态' }) as HTMLInputElement).checked).toBe(true)
    expect((within(longTermGroup).getByRole('radio', { name: '使用识别状态' }) as HTMLInputElement).disabled).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: '保存核对结果' }))

    await waitFor(() => expect(updateCredentialReview).toHaveBeenCalledWith(
      expect.objectContaining({
        credentialId: 'cred-existing',
        longTerm: true,
        confirmedFields: expect.objectContaining({
          decisions: expect.objectContaining({
            longTerm: 'keep-current',
          }),
        }),
      }),
    ))
  })
})
