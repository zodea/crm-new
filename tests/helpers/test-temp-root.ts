import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'
import { beforeEach } from 'vitest'
import { assertColdProcessesStopped } from './cold-process'

let ownedRoot: string | undefined
let testFailed = false

beforeEach(({ onTestFailed }) => {
  onTestFailed(() => {
    testFailed = true
  })
})

function isInside(parent: string, target: string): boolean {
  const path = relative(parent, target)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

/** A fresh directory owned by this isolated test file; reusable caches live elsewhere. */
export function testTempRoot(...parts: string[]): string {
  if (!ownedRoot) {
    const project = realpathSync(process.cwd())
    const temp = resolve(project, '.tmp')
    mkdirSync(temp, { recursive: true })
    if (lstatSync(temp).isSymbolicLink() || !isInside(project, realpathSync(temp)))
      throw new Error('测试临时根目录必须是项目内的普通目录。')
    const parent = join(temp, 'vitest-runs')
    mkdirSync(parent, { recursive: true })
    if (lstatSync(parent).isSymbolicLink() || !isInside(temp, realpathSync(parent)))
      throw new Error('测试临时目录不能是重解析点或位于项目外。')
    ownedRoot = mkdtempSync(join(parent, 'test-'))
  }
  const target = resolve(ownedRoot, ...parts)
  if (target !== ownedRoot && !isInside(ownedRoot, target))
    throw new Error('测试临时路径不能离开本次测试目录。')
  return target
}

/** Remove only this test file's own synthetic output after its other teardown hooks. */
export async function cleanupTestTempRoot(): Promise<void> {
  if (!ownedRoot || testFailed)
    return
  const project = realpathSync(process.cwd())
  const temp = resolve(project, '.tmp')
  const parent = resolve(temp, 'vitest-runs')
  const target = ownedRoot
  if (lstatSync(temp).isSymbolicLink() || lstatSync(parent).isSymbolicLink()
    || lstatSync(target).isSymbolicLink() || !isInside(parent, realpathSync(target))) {
    throw new Error('测试临时目录路径已变化，已保留产物。')
  }
  assertColdProcessesStopped()
  const visit = (path: string) => {
    const stat = lstatSync(path)
    if (stat.isSymbolicLink())
      throw new Error(`测试临时目录含重解析点，已保留产物：${path}`)
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path))
        visit(join(path, entry))
    }
  }
  visit(target)
  const tracked = execFileSync('git', ['ls-files', '--', relative(project, target)], { cwd: project, encoding: 'utf8' })
  if (tracked.trim())
    throw new Error('测试临时目录包含已跟踪文件，已保留产物。')
  await rm(target, { recursive: true })
  if (existsSync(target))
    throw new Error('测试临时目录未删除，请检查占用与权限。')
  ownedRoot = undefined
}
