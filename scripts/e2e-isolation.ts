import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function tempRoot(projectRoot: string): string {
  const root = realpathSync(projectRoot)
  const temp = resolve(root, '.tmp')
  if (!existsSync(temp) || lstatSync(temp).isSymbolicLink() || !lstatSync(temp).isDirectory() || relative(root, realpathSync(temp)) !== '.tmp')
    throw new Error('隔离验收要求项目内真实的 .tmp 目录')
  return realpathSync(temp)
}
function directChild(temp: string, path: string): string {
  const target = resolve(path)
  const child = relative(temp, target)
  if (!child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child) || child.includes(sep))
    throw new Error('隔离构建目标必须是项目 .tmp 的直接子目录')
  return target
}
function pathExists(path: string): boolean {
  try {
    lstatSync(path)
    return true
  }
  catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT')
      return false
    throw cause
  }
}
/** 构建工具会清理输出目录，故只接受尚未创建的两个独立目标。 */
export function isolatedFreshBuildPaths(projectRoot: string, buildDir: string, outputDir: string) {
  if (!buildDir.trim() || !outputDir.trim())
    throw new Error('必须明确指定独立构建与输出目录')
  const temp = tempRoot(projectRoot)
  const build = directChild(temp, resolve(projectRoot, buildDir))
  const output = directChild(temp, resolve(projectRoot, outputDir))
  if (build.toLocaleLowerCase('en-US') === output.toLocaleLowerCase('en-US') || pathExists(build) || pathExists(output))
    throw new Error('隔离构建与输出目录必须不同且尚不存在')
  return { build, output }
}

/** 仅从已构建的项目内隔离目录启动，逐层拒绝链接或重解析点。 */
export function isolatedServerEntry(projectRoot: string, entry: string): string {
  if (!entry.trim())
    throw new Error('必须明确指定隔离构建的服务入口')
  const temp = tempRoot(projectRoot)
  const target = resolve(projectRoot, entry)
  const server = dirname(target)
  const output = dirname(server)
  directChild(temp, output)
  if (target !== resolve(output, 'server', 'index.mjs') || server !== resolve(output, 'server'))
    throw new Error('隔离服务入口必须是构建目录内的 server/index.mjs')
  for (const path of [output, server, target]) {
    if (!existsSync(path) || lstatSync(path).isSymbolicLink())
      throw new Error('隔离服务入口缺失或包含重解析点')
  }
  if (!lstatSync(output).isDirectory() || !lstatSync(server).isDirectory() || !lstatSync(target).isFile() || realpathSync(target) !== target)
    throw new Error('隔离服务入口不是项目内的普通文件')
  return target
}

export function isolatedInheritedEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !key.toLocaleUpperCase('en-US').startsWith('CRM_')))
}
