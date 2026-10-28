import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, expect, it } from 'vitest'
import { trackColdProcess } from '../helpers/cold-process'
import { cleanupTestTempRoot, testTempRoot } from '../helpers/test-temp-root'

afterAll(cleanupTestTempRoot)

it('只清理本次测试生成的文件，保留跨次复用缓存', async () => {
  const root = testTempRoot()
  const fixture = join(root, 'synthetic.sqlite')
  const cache = '.tmp/vitest-cache'
  const cacheExisted = existsSync(cache)
  writeFileSync(fixture, 'synthetic fixture')
  expect(existsSync(fixture)).toBe(true)
  await cleanupTestTempRoot()
  expect(existsSync(root)).toBe(false)
  expect(existsSync(cache)).toBe(cacheExisted)
})

it('拒绝测试路径逃出本次隔离目录', () => {
  expect(() => testTempRoot('..', 'outside')).toThrow('不能离开')
})

it('测试子进程仍运行时保留目录，退出后才能清理', async () => {
  const root = testTempRoot()
  const child = trackColdProcess(spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true }))
  const closed = once(child, 'close')
  try {
    await expect(cleanupTestTempRoot()).rejects.toThrow('测试子进程仍在运行')
    expect(existsSync(root)).toBe(true)
  }
  finally {
    child.kill()
    await closed
  }
  await cleanupTestTempRoot()
  expect(existsSync(root)).toBe(false)
})
