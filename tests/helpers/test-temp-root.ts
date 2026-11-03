import { lstatSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import process from 'node:process'

let ownedRoot: string | undefined

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

/** Compatibility hook: keep synthetic artifacts until they can be reviewed safely. */
export function cleanupTestTempRoot(): Promise<void> {
  return Promise.resolve()
}
