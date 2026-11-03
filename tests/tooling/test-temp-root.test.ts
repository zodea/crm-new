import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, expect, it } from 'vitest'
import { trackColdProcess } from '../helpers/cold-process'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('结束钩子保留本次合成文件及跨次复用缓存', async () => {
  const root = testTempRoot()
  const fixture = join(root, 'synthetic.sqlite')
  const cache = '.tmp/vitest-cache'
  const cacheExisted = existsSync(cache)
  writeFileSync(fixture, 'synthetic fixture')
  expect(existsSync(fixture)).toBe(true)
  await cleanupTestTempRoot()
  expect(readFileSync(fixture, 'utf8')).toBe('synthetic fixture')
  expect(testTempRoot()).toBe(root)
  expect(existsSync(cache)).toBe(cacheExisted)
})

it('拒绝测试路径逃出本次隔离目录', () => {
  expect(() => testTempRoot('..', 'outside')).toThrow('不能离开')
})

it('无论测试子进程运行还是退出都保留目录', async () => {
  const root = testTempRoot()
  const child = trackColdProcess(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true }))
  const closed = once(child, 'close')
  try {
    await expect(cleanupTestTempRoot()).resolves.toBeUndefined()
    expect(existsSync(root)).toBe(true)
  }
  finally {
    child.kill()
    await closed
  }
  await cleanupTestTempRoot()
  expect(existsSync(root)).toBe(true)
})
