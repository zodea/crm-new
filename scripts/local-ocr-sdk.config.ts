import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { defineConfig } from 'vite'

// 构建必须写入全新、直接位于项目 .tmp 下的目录；不能清理或覆盖运行中的服务和模型。
const temporaryRoot = resolve('.tmp')
const requestedOutput = process.env.CRM_LOCAL_OCR_BUNDLE_OUTPUT
if (!requestedOutput)
  throw new Error('请指定项目 .tmp 下尚不存在的 OCR 构建目录')
const output = resolve(requestedOutput)
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
function absent(path: string): boolean {
  try {
    lstatSync(path)
    return false
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return true
    throw error
  }
}
if (!lstatSync(temporaryRoot).isDirectory() || lstatSync(temporaryRoot).isSymbolicLink()
  || !samePath(realpathSync(temporaryRoot), temporaryRoot) || !samePath(dirname(output), temporaryRoot) || !absent(output)) {
  throw new Error('OCR 构建目标必须是项目 .tmp 下尚不存在的普通目录')
}

const sdkRequire = createRequire(import.meta.resolve('@paddleocr/paddleocr-js'))
const runtimeDir = dirname(sdkRequire.resolve('onnxruntime-web'))
const runtimeFiles = ['ort.bundle.min.mjs', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'] as const
const runtimeRequire = createRequire(sdkRequire.resolve('onnxruntime-web'))
const yamlRequire = createRequire(sdkRequire.resolve('js-yaml'))
const protobufRequire = createRequire(runtimeRequire.resolve('protobufjs'))

function packageRoot(name: string, resolver: NodeRequire): { root: string, version: string } {
  let root = dirname(resolver.resolve(name))
  for (;;) {
    const manifest = resolve(root, 'package.json')
    if (!absent(manifest)) {
      const data = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: unknown, version?: unknown }
      if (data.name === name && typeof data.version === 'string')
        return { root, version: data.version }
    }
    const parent = dirname(root)
    if (parent === root)
      throw new Error(`无法核对识别依赖的许可证：${name}`)
    root = parent
  }
}

function bundledLicense(name: string, resolver: NodeRequire, file = 'LICENSE'): string {
  const pkg = packageRoot(name, resolver)
  return `\n\n--- ${name} ${pkg.version} ---\n\n${readFileSync(resolve(pkg.root, file), 'utf8')}`
}

function licenseNotices(): string {
  const thirdParty = [
    bundledLicense('@techstark/opencv-js', sdkRequire),
    bundledLicense('js-yaml', sdkRequire),
    bundledLicense('argparse', yamlRequire),
    bundledLicense('flatbuffers', runtimeRequire),
    bundledLicense('long', runtimeRequire),
    bundledLicense('platform', runtimeRequire),
    bundledLicense('protobufjs', runtimeRequire),
    ...['aspromise', 'base64', 'codegen', 'eventemitter', 'fetch', 'float', 'path', 'pool', 'utf8']
      .map(name => bundledLicense(`@protobufjs/${name}`, protobufRequire)),
  ]
  const clipper = packageRoot('clipper-lib', sdkRequire)
  const clipperSource = readFileSync(resolve(clipper.root, 'clipper.js'), 'utf8')
  const clipperNotice = clipperSource.slice(0, clipperSource.indexOf('*/') + 2)
  if (!clipperNotice.includes('Boost Software License'))
    throw new Error('无法核对 clipper-lib 许可声明')
  return [
    'Local OCR third-party notices. Bundled assets may be transformed; their original license terms are reproduced below.',
    `\n--- @paddleocr/paddleocr-js 0.4.2 and PaddleOCR models ---\n\n${readFileSync(resolve('scripts/ocr-licenses/paddleocr-apache-2.0.txt'), 'utf8')}`,
    `\n--- onnxruntime-web / onnxruntime-common ---\n\n${readFileSync(resolve('scripts/ocr-licenses/onnxruntime-mit.txt'), 'utf8')}`,
    `\n--- clipper-lib ${clipper.version} ---\n\n${clipperNotice}\n\n${readFileSync(resolve('scripts/ocr-licenses/boost-1.0.txt'), 'utf8')}`,
    `\n--- guid-typescript (package author: nicolas; ISC) ---\nThe published package identifies its license as ISC but contains no separate copyright notice or license file. The ISC license text follows.\n\n${readFileSync(resolve('scripts/ocr-licenses/isc.txt'), 'utf8')}`,
    ...thirdParty,
  ].join('\n')
}

export default defineConfig({
  build: {
    outDir: output,
    emptyOutDir: false,
    lib: { entry: resolve('scripts/local-ocr-sdk-entry.ts'), formats: ['es'], fileName: 'paddleocr' },
    rollupOptions: {
      external: ['onnxruntime-web'],
      output: { paths: { 'onnxruntime-web': './ort.bundle.min.mjs' } },
    },
  },
  plugins: [{
    name: 'local-ocr-runtime-files',
    generateBundle() {
      for (const name of runtimeFiles)
        this.emitFile({ type: 'asset', fileName: name, source: readFileSync(resolve(runtimeDir, name)) })
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: licenseNotices() })
    },
  }],
})
