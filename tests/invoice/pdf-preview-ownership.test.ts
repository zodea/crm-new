/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderPdfPreviewPages } from '../../app/lib/invoice/pdf-preview'

const pdfjs = vi.hoisted(() => ({ getDocument: vi.fn() }))
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument: pdfjs.getDocument }))
vi.mock('pdfjs-dist/legacy/build/pdf.worker.mjs', () => ({ WorkerMessageHandler: {} }))

const primaryError = new Error('合成页面渲染失败')
const cleanupError = new Error('合成 PDF 销毁失败')
const created: string[] = []
const revoked: string[] = []

beforeEach(() => {
  created.length = 0
  revoked.length = 0
  pdfjs.getDocument.mockReset()
  const OriginalURL = globalThis.URL
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL() {
      const url = `blob:synthetic-${created.length + 1}`
      created.push(url)
      return url
    }

    static revokeObjectURL(url: string) { revoked.push(url) }
  })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
    callback(new Blob(['synthetic-page'], { type: 'image/png' }))
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function fixture(options: { failPage?: number, failCleanup?: boolean, failDestroy?: boolean, numPages?: number } = {}) {
  const source = new File(['synthetic'], '合成.pdf', { type: 'application/pdf' })
  Object.defineProperty(source, 'arrayBuffer', { value: async () => new Uint8Array([1, 2, 3]).buffer })
  const render = vi.fn((number: number) => ({
    promise: number === options.failPage ? Promise.reject(primaryError) : Promise.resolve(),
  }))
  const getPage = vi.fn(async (number: number) => ({
    getViewport: () => ({ width: 100, height: 200 }),
    render: () => render(number),
  }))
  const cleanup = vi.fn(async () => {
    if (options.failCleanup)
      throw primaryError
  })
  const destroy = vi.fn(async () => {
    if (options.failDestroy)
      throw cleanupError
  })
  pdfjs.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: options.numPages ?? 2, getPage, cleanup }), destroy })
  return { source, getPage, cleanup, destroy }
}

it('成功后交出两页 URL，调用者才负责回收', async () => {
  const f = fixture()
  const result = await renderPdfPreviewPages(f.source)
  expect(result.pages.map(page => page.url)).toEqual(['blob:synthetic-1', 'blob:synthetic-2'])
  expect(result.totalPages).toBe(2)
  expect(f.cleanup).toHaveBeenCalledOnce()
  expect(f.destroy).toHaveBeenCalledOnce()
  expect(revoked).toEqual([])
  result.pages.forEach(page => URL.revokeObjectURL(page.url))
  expect(revoked).toEqual(created)
})

it('两页成功但销毁失败时不交出 URL，并回收所有已创建页', async () => {
  const f = fixture({ failDestroy: true })
  await expect(renderPdfPreviewPages(f.source)).rejects.toBe(cleanupError)
  expect(created).toEqual(['blob:synthetic-1', 'blob:synthetic-2'])
  expect(revoked).toEqual(created)
  expect(f.destroy).toHaveBeenCalledOnce()
})

it('销毁尚未完成时不交出页图，完成后移交调用者', async () => {
  const f = fixture()
  let finish!: () => void
  f.destroy.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finish = resolve
  }))
  let settled = false
  const pending = renderPdfPreviewPages(f.source).then((value) => {
    settled = true
    return value
  })
  await vi.waitFor(() => expect(f.destroy).toHaveBeenCalledOnce())
  expect(created).toHaveLength(2)
  expect(settled).toBe(false)
  expect(revoked).toEqual([])
  finish()
  const result = await pending
  expect(result.pages.map(page => page.url)).toEqual(created)
  result.pages.forEach(page => URL.revokeObjectURL(page.url))
  expect(revoked).toEqual(created)
})

it('加载任务失败仍销毁并保留原错误', async () => {
  const f = fixture()
  pdfjs.getDocument.mockReturnValueOnce({ promise: Promise.reject(primaryError), destroy: f.destroy })
  await expect(renderPdfPreviewPages(f.source)).rejects.toBe(primaryError)
  expect(created).toEqual([])
  expect(revoked).toEqual([])
  expect(f.destroy).toHaveBeenCalledOnce()
})

it('后续页创建 URL 失败时回收此前页面并保留原错误', async () => {
  const f = fixture()
  const create = URL.createObjectURL.bind(URL)
  vi.spyOn(URL, 'createObjectURL')
    .mockImplementationOnce(blob => create(blob))
    .mockImplementationOnce(() => { throw primaryError })
  await expect(renderPdfPreviewPages(f.source)).rejects.toBe(primaryError)
  expect(created).toEqual(['blob:synthetic-1'])
  expect(revoked).toEqual(created)
  expect(f.destroy).toHaveBeenCalledOnce()
})

it('第二页失败但销毁成功时保留原始错误并回收已创建页', async () => {
  const f = fixture({ failPage: 2 })
  await expect(renderPdfPreviewPages(f.source)).rejects.toBe(primaryError)
  expect(created).toEqual(['blob:synthetic-1'])
  expect(revoked).toEqual(created)
  expect(f.destroy).toHaveBeenCalledOnce()
})

it.each(['成功', '失败'] as const)('第二页失败后销毁等待期间立即回收，销毁%s后只回收一次', async (outcome) => {
  const f = fixture({ failPage: 2 })
  let finish!: () => void
  let fail!: (error: unknown) => void
  f.destroy.mockImplementationOnce(() => new Promise<void>((resolve, reject) => {
    finish = resolve
    fail = reject
  }))
  const pending = renderPdfPreviewPages(f.source).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
  await vi.waitFor(() => expect(f.destroy).toHaveBeenCalledOnce())
  const revokedDuringDestroy = [...revoked]
  if (outcome === '成功')
    finish()
  else
    fail(cleanupError)
  const result = await pending
  expect(created).toEqual(['blob:synthetic-1'])
  expect(revokedDuringDestroy).toEqual(created)
  expect(revoked).toEqual(created)
  expect(result.ok).toBe(false)
  if (!result.ok && outcome === '成功')
    expect(result.error).toBe(primaryError)
  if (!result.ok && outcome === '失败') {
    expect(result.error).toBeInstanceOf(AggregateError)
    expect((result.error as AggregateError).errors).toEqual([primaryError, cleanupError])
  }
})

it.each([undefined, null])('渲染以 %s 拒绝且销毁成功时仍然拒绝并保留原值', async (reason) => {
  const f = fixture()
  f.getPage.mockImplementationOnce(async () => {
    throw reason
  })
  const result = await renderPdfPreviewPages(f.source).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
  expect(result).toEqual({ ok: false, error: reason })
  expect(f.destroy).toHaveBeenCalledOnce()
  expect(revoked).toEqual([])
})

it.each([undefined, null])('渲染以 %s 拒绝且销毁也失败时同时保留两种原因', async (reason) => {
  const f = fixture({ failDestroy: true })
  f.getPage.mockImplementationOnce(async () => {
    throw reason
  })
  const result = await renderPdfPreviewPages(f.source).then(() => null, error => error)
  expect(result).toBeInstanceOf(AggregateError)
  expect((result as AggregateError).errors).toEqual([reason, cleanupError])
  expect(revoked).toEqual([])
})

it.each([undefined, null])('成功渲染后销毁以 %s 拒绝时回收页图且保留拒绝值', async (reason) => {
  const f = fixture()
  f.destroy.mockRejectedValueOnce(reason)
  const result = await renderPdfPreviewPages(f.source).then(() => ({ ok: true as const }), error => ({ ok: false as const, error }))
  expect(result).toEqual({ ok: false, error: reason })
  expect(created).toHaveLength(2)
  expect(revoked).toEqual(created)
})

it('pdf cleanup 失败但 destroy 成功时保留原错误并回收所有页', async () => {
  const f = fixture({ failCleanup: true })
  await expect(renderPdfPreviewPages(f.source)).rejects.toBe(primaryError)
  expect(created).toHaveLength(2)
  expect(revoked).toEqual(created)
  expect(f.destroy).toHaveBeenCalledOnce()
})

it('页图生成失败时不交出或伪造 URL，仍销毁 PDF', async () => {
  const f = fixture()
  vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementationOnce(callback => callback(null))
  await expect(renderPdfPreviewPages(f.source)).rejects.toThrow('页面位图生成失败')
  expect(created).toEqual([])
  expect(revoked).toEqual([])
  expect(f.destroy).toHaveBeenCalledOnce()
})

it('超过页数上限仍如实返回总页数，并只把已生成页移交调用者', async () => {
  const f = fixture({ numPages: 12 })
  const result = await renderPdfPreviewPages(f.source)
  expect(result.totalPages).toBe(12)
  expect(result.pages).toHaveLength(10)
  expect(f.getPage).toHaveBeenCalledTimes(10)
  expect(revoked).toEqual([])
  result.pages.forEach(page => URL.revokeObjectURL(page.url))
  expect(revoked).toEqual(created)
  expect(f.destroy).toHaveBeenCalledOnce()
})

it.each(['render', 'cleanup'] as const)('原 %s 错误与销毁错误同时发生时均可诊断且 URL 只回收一次', async (stage) => {
  const f = fixture({ ...(stage === 'render' ? { failPage: 2 } : { failCleanup: true }), failDestroy: true })
  const result = await renderPdfPreviewPages(f.source).then(() => null, error => error)
  expect(result).toBeInstanceOf(AggregateError)
  expect((result as AggregateError).errors).toEqual([primaryError, cleanupError])
  expect(created).toHaveLength(stage === 'render' ? 1 : 2)
  expect(revoked).toEqual(created)
  expect(f.destroy).toHaveBeenCalledOnce()
})
