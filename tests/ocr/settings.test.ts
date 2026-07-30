import { describe, expect, it, vi } from 'vitest'
import { activeNavKey, NAV_TREE } from '~/lib/nav/nav-tree'
import { fetchOcrRuntimeStatus, OCR_DOCUMENT_SUPPORT } from '~/lib/ocr/settings'
import { routeSubtitle, routeTitle } from '~/lib/tabs/tab-title'

describe('ocr 设置运行状态', () => {
  it('只读取服务端脱敏状态，不要求或返回 Token 值', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({
      configured: true,
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const status = await fetchOcrRuntimeStatus(fetch)

    expect(fetch).toHaveBeenCalledWith('/api/ocr/status', {
      headers: { Accept: 'application/json' },
    })
    expect(status).toEqual({
      configured: true,
      engine: 'paddleocr-official-api',
      model: 'PaddleOCR-VL-1.6',
    })
    expect(status).not.toHaveProperty('accessToken')
  })

  it('服务异常和结构漂移时明确失败，不伪造“已配置”', async () => {
    const failedStatus = fetchOcrRuntimeStatus(async () => new Response('down', { status: 503 }))
    await expect(failedStatus).rejects.toThrow('OCR 配置状态读取失败')

    const invalidStatus = fetchOcrRuntimeStatus(async () => new Response(JSON.stringify({
      configured: 'yes',
      engine: 'unknown',
    }), { status: 200 }))
    await expect(invalidStatus).rejects.toThrow('OCR 配置状态格式无效')
  })

  it('单据矩阵只声明现有真实接入，不把清单拆表标成 OCR 可用', () => {
    expect(OCR_DOCUMENT_SUPPORT).toEqual([
      expect.objectContaining({ id: 'invoice', availability: 'available', engine: 'PaddleOCR-VL 1.6' }),
      expect.objectContaining({ id: 'delivery', availability: 'available', engine: 'PaddleOCR-VL 1.6' }),
      expect.objectContaining({ id: 'boq', availability: 'unavailable', engine: '未接入' }),
    ])
  })
})

describe('ocr 设置路由入口', () => {
  it('侧栏、激活态和页签标题形成完整路由', () => {
    const item = NAV_TREE
      .flatMap(node => node.type === 'group' ? node.items : [node])
      .find(candidate => candidate.key === 'ocrSettings')

    expect(item?.to).toBe('/settings/ocr')
    expect(activeNavKey('/settings/ocr')).toBe('ocrSettings')
    expect(routeTitle('/settings/ocr')).toBe('OCR 设置')
    expect(routeSubtitle('/settings/ocr')).toBe('引擎状态 · 单据接入 · 参数边界')
  })
})
