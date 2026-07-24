const ANALYSIS_MAX_EDGE = 640
const MIN_COMPONENT_SIDE_RATIO = 0.1
const MIN_ROTATION_RADIANS = Math.PI / 180 * 1.5
const CROP_PADDING_RATIO = 0.18

export interface PixelImageData {
  width: number
  height: number
  data: Uint8ClampedArray
}

export interface DocumentGeometry {
  x: number
  y: number
  width: number
  height: number
  angleRadians: number
  inkPixels: number
}

export interface PreparedOcrImage {
  file: File
  transformed: boolean
  useDocOrientationClassify: boolean
}

interface Component {
  count: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  sumX: number
  sumY: number
  sumXX: number
  sumYY: number
  sumXY: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function isInk(data: Uint8ClampedArray, offset: number): boolean {
  const red = data[offset] ?? 255
  const green = data[offset + 1] ?? 255
  const blue = data[offset + 2] ?? 255
  const alpha = data[offset + 3] ?? 255
  if (alpha < 32)
    return false
  const darkest = Math.min(red, green, blue)
  const lightest = Math.max(red, green, blue)
  const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
  return luminance < 238 || (lightest - darkest > 18 && darkest < 248)
}

function componentAngle(component: Component): number {
  const meanX = component.sumX / component.count
  const meanY = component.sumY / component.count
  const covarianceXX = component.sumXX / component.count - meanX * meanX
  const covarianceYY = component.sumYY / component.count - meanY * meanY
  const covarianceXY = component.sumXY / component.count - meanX * meanY
  const trace = covarianceXX + covarianceYY
  const delta = Math.sqrt((covarianceXX - covarianceYY) ** 2 + 4 * covarianceXY ** 2)
  const major = (trace + delta) / 2
  const minor = Math.max(0.0001, (trace - delta) / 2)
  if (major / minor < 1.15)
    return 0
  return 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY)
}

/**
 * 在缩略图像素中寻找最大的二维票据/表格连通域。
 * 会排除贴边细线，避免扫描件顶部黑边把裁剪框错误扩成整页。
 */
export function detectDocumentGeometry(image: PixelImageData): DocumentGeometry | null {
  const { width, height, data } = image
  if (width < 8 || height < 8 || data.length < width * height * 4)
    return null

  const pixelCount = width * height
  const ink = new Uint8Array(pixelCount)
  const visited = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  const edge = Math.max(2, Math.round(Math.min(width, height) * 0.01))

  for (let y = edge; y < height - edge; y += 1) {
    for (let x = edge; x < width - edge; x += 1) {
      const index = y * width + x
      if (isInk(data, index * 4))
        ink[index] = 1
    }
  }

  const minWidth = width * MIN_COMPONENT_SIDE_RATIO
  const minHeight = height * MIN_COMPONENT_SIDE_RATIO
  const minPixels = Math.max(20, Math.round(Math.min(width, height) * 0.15))
  let best: Component | null = null
  let bestScore = 0

  for (let start = 0; start < pixelCount; start += 1) {
    if (!ink[start] || visited[start])
      continue

    let head = 0
    let tail = 1
    queue[0] = start
    visited[start] = 1
    const component: Component = {
      count: 0,
      minX: width,
      minY: height,
      maxX: 0,
      maxY: 0,
      sumX: 0,
      sumY: 0,
      sumXX: 0,
      sumYY: 0,
      sumXY: 0,
    }

    while (head < tail) {
      const index = queue[head++]!
      const x = index % width
      const y = Math.floor(index / width)
      component.count += 1
      component.minX = Math.min(component.minX, x)
      component.minY = Math.min(component.minY, y)
      component.maxX = Math.max(component.maxX, x)
      component.maxY = Math.max(component.maxY, y)
      component.sumX += x
      component.sumY += y
      component.sumXX += x * x
      component.sumYY += y * y
      component.sumXY += x * y

      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0)
            continue
          const nextX = x + offsetX
          const nextY = y + offsetY
          if (nextX < edge || nextX >= width - edge || nextY < edge || nextY >= height - edge)
            continue
          const next = nextY * width + nextX
          if (!ink[next] || visited[next])
            continue
          visited[next] = 1
          queue[tail++] = next
        }
      }
    }

    const componentWidth = component.maxX - component.minX + 1
    const componentHeight = component.maxY - component.minY + 1
    if (component.count < minPixels || componentWidth < minWidth || componentHeight < minHeight)
      continue
    const area = componentWidth * componentHeight
    const score = area * Math.log2(component.count + 1)
    if (score > bestScore) {
      best = component
      bestScore = score
    }
  }

  if (!best)
    return null
  return {
    x: best.minX,
    y: best.minY,
    width: best.maxX - best.minX + 1,
    height: best.maxY - best.minY + 1,
    angleRadians: componentAngle(best),
    inkPixels: best.count,
  }
}

function outputFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '') || 'document'
  return `${withoutExtension}.ocr.png`
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob)
        resolve(blob)
      else
        reject(new Error('浏览器无法生成 OCR 预处理图片'))
    }, 'image/png')
  })
}

/**
 * 送货单图片在浏览器内自动裁白边、扶正并略微增强对比度。
 * 原文件仍用于界面预览；只有派生 PNG 上传到同源 OCR 代理。
 */
export async function prepareDeliveryOcrImage(file: File): Promise<PreparedOcrImage> {
  if (!/^image\/(?:png|jpe?g)$/i.test(file.type) || typeof createImageBitmap !== 'function') {
    return { file, transformed: false, useDocOrientationClassify: true }
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const analysisScale = Math.min(1, ANALYSIS_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const analysisCanvas = document.createElement('canvas')
    analysisCanvas.width = Math.max(1, Math.round(bitmap.width * analysisScale))
    analysisCanvas.height = Math.max(1, Math.round(bitmap.height * analysisScale))
    const analysisContext = analysisCanvas.getContext('2d', { willReadFrequently: true })
    if (!analysisContext)
      return { file, transformed: false, useDocOrientationClassify: true }
    analysisContext.drawImage(bitmap, 0, 0, analysisCanvas.width, analysisCanvas.height)
    const geometry = detectDocumentGeometry(analysisContext.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height))
    if (!geometry)
      return { file, transformed: false, useDocOrientationClassify: true }

    const sourceScaleX = bitmap.width / analysisCanvas.width
    const sourceScaleY = bitmap.height / analysisCanvas.height
    const padX = geometry.width * CROP_PADDING_RATIO
    const padY = geometry.height * CROP_PADDING_RATIO
    const cropX = clamp((geometry.x - padX) * sourceScaleX, 0, bitmap.width)
    const cropY = clamp((geometry.y - padY) * sourceScaleY, 0, bitmap.height)
    const cropRight = clamp((geometry.x + geometry.width + padX) * sourceScaleX, 0, bitmap.width)
    const cropBottom = clamp((geometry.y + geometry.height + padY) * sourceScaleY, 0, bitmap.height)
    const cropWidth = cropRight - cropX
    const cropHeight = cropBottom - cropY
    const rotation = Math.abs(geometry.angleRadians) >= MIN_ROTATION_RADIANS
      ? -geometry.angleRadians
      : 0
    const cropped = cropWidth < bitmap.width * 0.94 || cropHeight < bitmap.height * 0.94
    if (!cropped && rotation === 0)
      return { file, transformed: false, useDocOrientationClassify: true }

    const cosine = Math.abs(Math.cos(rotation))
    const sine = Math.abs(Math.sin(rotation))
    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = Math.max(1, Math.ceil(cropWidth * cosine + cropHeight * sine))
    outputCanvas.height = Math.max(1, Math.ceil(cropWidth * sine + cropHeight * cosine))
    const outputContext = outputCanvas.getContext('2d')
    if (!outputContext)
      return { file, transformed: false, useDocOrientationClassify: true }
    outputContext.fillStyle = '#fff'
    outputContext.fillRect(0, 0, outputCanvas.width, outputCanvas.height)
    outputContext.translate(outputCanvas.width / 2, outputCanvas.height / 2)
    outputContext.rotate(rotation)
    outputContext.filter = 'contrast(1.15)'
    outputContext.drawImage(
      bitmap,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      -cropWidth / 2,
      -cropHeight / 2,
      cropWidth,
      cropHeight,
    )

    const blob = await canvasBlob(outputCanvas)
    return {
      file: new File([blob], outputFileName(file.name), { type: 'image/png', lastModified: file.lastModified }),
      transformed: true,
      useDocOrientationClassify: false,
    }
  }
  catch {
    return { file, transformed: false, useDocOrientationClassify: true }
  }
  finally {
    bitmap?.close()
  }
}
