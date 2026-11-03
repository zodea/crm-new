import { randomUUID } from 'node:crypto'
import { lstatSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

// 显式指定仅用于测试的本机开发服务，避免意外连接用户正在使用的局域网入口。
const baseURL = process.env.CRM_OCR_TEST_BASE_URL
if (!baseURL)
  throw new Error('请设置隔离开发服务地址 CRM_OCR_TEST_BASE_URL')
const url = new URL(baseURL)
if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.search || url.hash)
  throw new Error('识别浏览器测试只能连接本机隔离开发服务')

// Playwright 会清空输出目录，因此只接受项目 .tmp 下尚不存在的普通目录。
const temporaryRoot = resolve('.tmp')
const requestedOutput = process.env.CRM_OCR_TEST_OUTPUT
if (!requestedOutput)
  throw new Error('请指定项目 .tmp 下尚不存在的测试输出目录')
// Playwright 在主进程及工作进程分别加载配置；每次均分配新目录，不能因重载而误删上次输出。
const outputDir = resolve(`${requestedOutput}-${randomUUID()}`)
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
let exists = true
try {
  lstatSync(outputDir)
}
catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
    throw error
  exists = false
}
if (!lstatSync(temporaryRoot).isDirectory() || lstatSync(temporaryRoot).isSymbolicLink()
  || !samePath(realpathSync(temporaryRoot), temporaryRoot) || !samePath(dirname(outputDir), temporaryRoot) || exists) {
  throw new Error('测试输出必须是项目 .tmp 下尚不存在的普通目录')
}

export default defineConfig({
  testDir: '.',
  testMatch: 'runtime.spec.ts',
  outputDir,
  workers: 1,
  use: { ...devices['Desktop Chrome'], baseURL },
})
