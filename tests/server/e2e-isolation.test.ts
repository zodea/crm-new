import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isolatedFreshBuildPaths, isolatedInheritedEnvironment, isolatedServerEntry } from '../../scripts/e2e-isolation'
import { createDemoWorkspaceTestInstance } from '../../server/utils/demo-workspace-test-instance'
import { testTempRoot } from '../helpers/test-temp-root'

async function fixture() {
  const base = testTempRoot('isolated-build-check')
  await mkdir(base, { recursive: true })
  const project = await mkdtemp(`${base}/project-`)
  await mkdir(join(project, '.tmp'))
  return { project, temp: join(project, '.tmp') }
}

it('只接受项目 .tmp 内不同且不存在的直接子目录，拒绝同路径、嵌套、越界和已有目标', async () => {
  const { project, temp } = await fixture()
  expect(isolatedFreshBuildPaths(project, '.tmp/build-new', '.tmp/output-new')).toEqual({ build: resolve(temp, 'build-new'), output: resolve(temp, 'output-new') })
  expect(() => isolatedFreshBuildPaths(project, '.tmp/same', '.tmp/same')).toThrow('不同且尚不存在')
  expect(() => isolatedFreshBuildPaths(project, '.tmp/build', '.tmp/build/nested')).toThrow('直接子目录')
  expect(() => isolatedFreshBuildPaths(project, '.tmp/build', '.output')).toThrow('直接子目录')
  await mkdir(join(temp, 'existing'))
  expect(() => isolatedFreshBuildPaths(project, '.tmp/build', '.tmp/existing')).toThrow('尚不存在')
  await symlink(join(temp, 'existing'), join(temp, 'linked'), 'junction')
  expect(() => isolatedFreshBuildPaths(project, '.tmp/build', '.tmp/linked')).toThrow('尚不存在')
})

it('正式验收只可启动已生成的独立服务入口，拒绝链接、旧输出及不存在的目标', async () => {
  const { project, temp } = await fixture()
  const output = join(temp, 'isolated-output')
  await mkdir(join(output, 'server'), { recursive: true })
  await writeFile(join(output, 'server', 'index.mjs'), '// synthetic entry\n')
  expect(isolatedServerEntry(project, '.tmp/isolated-output/server/index.mjs')).toBe(resolve(output, 'server', 'index.mjs'))
  expect(() => isolatedServerEntry(project, '.output/server/index.mjs')).toThrow('直接子目录')
  expect(() => isolatedServerEntry(project, '.tmp/absent/server/index.mjs')).toThrow('缺失')
  await symlink(output, join(temp, 'linked-output'), 'junction')
  expect(() => isolatedServerEntry(project, '.tmp/linked-output/server/index.mjs')).toThrow('重解析点')
})

it('子进程不会继承用户 CRM 配置，其余常规执行环境保持可用', () => {
  expect(isolatedInheritedEnvironment({ CRM_DATA_DIRECTORY: 'user-path', crm_access_code_hash: 'secret', PATH: 'runtime-path', NODE_OPTIONS: '--max-old-space-size=3072' })).toEqual({ PATH: 'runtime-path', NODE_OPTIONS: '--max-old-space-size=3072' })
})

describe('global demo workspace capability boundary', () => {
  it('只按会话 capability override 授权，不消费项目读场景', () => {
    const instance = createDemoWorkspaceTestInstance()

    expect(instance.workspace('ready')).toEqual({ allowed: true })
    instance.reset('forbidden', 'denied')
    expect(instance.workspace('denied')).toEqual({ allowed: false })
    expect(instance.workspace('project-forbidden')).toEqual({ allowed: true })
    expect(instance.workspace('project-unavailable')).toEqual({ allowed: true })
  })

  it('分供方敏感资料权限只授予指定会话，撤销后立即失效', () => {
    const instance = createDemoWorkspaceTestInstance()
    expect(instance.capabilities('a')).not.toContain('supplier:sensitive:read')
    instance.setSupplierPrivateRead('a', true)
    expect(instance.capabilities('a')).toContain('supplier:sensitive:read')
    expect(instance.capabilities('b')).not.toContain('supplier:sensitive:read')
    expect(instance.capabilities()).not.toContain('supplier:sensitive:read')
    instance.setSupplierPrivateRead('a', false)
    expect(instance.capabilities('a')).not.toContain('supplier:sensitive:read')
  })
})
