import { describe, expect, it } from 'vitest'
import { detectDocumentGeometry } from '~/lib/recognize/image-preprocess'

function blankImage(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4).fill(255)
}

function pixel(data: Uint8ClampedArray, width: number, x: number, y: number, color = 40) {
  const offset = (y * width + x) * 4
  data[offset] = color
  data[offset + 1] = color
  data[offset + 2] = color
  data[offset + 3] = 255
}

function rectangle(data: Uint8ClampedArray, width: number, left: number, top: number, right: number, bottom: number) {
  for (let x = left; x <= right; x += 1) {
    pixel(data, width, x, top)
    pixel(data, width, x, bottom)
  }
  for (let y = top; y <= bottom; y += 1) {
    pixel(data, width, left, y)
    pixel(data, width, right, y)
  }
  for (let y = top + 10; y < bottom; y += 10) {
    for (let x = left; x <= right; x += 1)
      pixel(data, width, x, y, 120)
  }
}

describe('detectDocumentGeometry', () => {
  it('忽略贴边扫描黑线并找到页面中央的纵向票据', () => {
    const width = 120
    const height = 180
    const data = blankImage(width, height)
    for (let x = 0; x < width; x += 1)
      pixel(data, width, x, 0)
    rectangle(data, width, 38, 35, 92, 155)

    const result = detectDocumentGeometry({ width, height, data })

    expect(result).toMatchObject({ x: 38, y: 35, width: 55, height: 121 })
    expect(Math.abs(result!.angleRadians)).toBeGreaterThan(1.3)
  })

  it('横向表格保持接近零度，纯白或无效图片不误裁', () => {
    const width = 160
    const height = 100
    const data = blankImage(width, height)
    rectangle(data, width, 15, 25, 145, 78)

    const result = detectDocumentGeometry({ width, height, data })

    expect(result).not.toBeNull()
    expect(Math.abs(result!.angleRadians)).toBeLessThan(0.1)
    expect(detectDocumentGeometry({ width, height, data: blankImage(width, height) })).toBeNull()
    expect(detectDocumentGeometry({ width: 1, height: 1, data: new Uint8ClampedArray(4) })).toBeNull()
  })
})
