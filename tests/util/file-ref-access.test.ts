import type { FileRefRecord } from '~/lib/forms/file-refs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileRefAccess } from '~/composables/useFileRefAccess'
import { loadFileRefContent } from '~/lib/forms/file-refs'

const warning = vi.fn()
const error = vi.fn()

vi.mock('~/lib/forms/file-refs', () => ({
  loadFileRefContent: vi.fn(),
}))

const file: FileRefRecord = {
  id: 'file-1',
  ownerType: 'contract',
  ownerId: 'contract-1',
  fileName: '合同附件.html',
  filePath: '',
  fileSize: 20,
  mimeType: 'text/html',
  category: '合同附件',
  uploader: '',
  uploadedAt: '2026-07-30',
  deletedAt: null,
}

beforeEach(() => {
  vi.stubGlobal('useKitUI', () => ({ error, warning }))
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('file reference preview safety', () => {
  it('活动内容不读取也不打开，提示用户下载后查看', async () => {
    const { preview } = useFileRefAccess()
    await preview(file)

    expect(loadFileRefContent).not.toHaveBeenCalled()
    expect(warning).toHaveBeenCalledWith('该文件类型不支持安全预览，请下载后查看')
  })
})
