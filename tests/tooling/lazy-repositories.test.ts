import type { DomainRepositories } from '~/plugins/repositories'
import { expect, it, vi } from 'vitest'
import { deferredRepository, lazyDomain } from '~/lib/repositories/deferred'

it('loads on the first method call and shares the domain across concurrent repositories', async () => {
  const list = vi.fn(async (page: number) => ({ page }))
  const execute = vi.fn(async (commandId: string) => ({ commandId }))
  const load = vi.fn(async () => ({ read: { list }, write: { execute } }))
  const domain = lazyDomain(load)
  const read = deferredRepository(async () => (await domain()).read, ['list'])
  const write = deferredRepository(async () => (await domain()).write, ['execute'])
  const listPage = read.list

  expect({ ...read }.list).toBe(listPage)
  expect('list' in read).toBe(true)
  expect(read.list).toBe(listPage)
  expect(load).not.toHaveBeenCalled()
  await expect(Promise.all([listPage(2), write.execute('original-command')])).resolves.toEqual([
    { page: 2 },
    { commandId: 'original-command' },
  ])
  expect(load).toHaveBeenCalledTimes(1)
  await expect(read.list(3)).resolves.toEqual({ page: 3 })
  expect(load).toHaveBeenCalledTimes(1)
  expect(execute).toHaveBeenCalledExactlyOnceWith('original-command')
})

it('propagates a failed load and retries the same operation on the next call', async () => {
  const resolveCommand = vi.fn(async (key: string) => ({ outcome: 'applied', key }))
  const load = vi.fn(async () => ({ resolveCommand }))
    .mockRejectedValueOnce(new Error('测试模块暂不可加载'))
  const repository = deferredRepository(lazyDomain(load), ['resolveCommand'])

  await expect(repository.resolveCommand('original-command')).rejects.toThrow('测试模块暂不可加载')
  expect(resolveCommand).not.toHaveBeenCalled()
  await expect(repository.resolveCommand('original-command')).resolves.toEqual({ outcome: 'applied', key: 'original-command' })
  expect(resolveCommand).toHaveBeenCalledExactlyOnceWith('original-command')
  expect(load).toHaveBeenCalledTimes(2)
})

it('所有注入仓储在读取、解构和对象展开时均保留真实 HTTP 工厂的方法', async () => {
  vi.stubGlobal('defineNuxtPlugin', (plugin: unknown) => plugin)
  try {
    const { createDomainRepositories } = await import('~/plugins/repositories')
    const fetcher = vi.fn(async (): Promise<never> => {
      throw new Error('核对仓储方法不应请求接口')
    })
    const exposed = createDomainRepositories(fetcher, fetcher)
    type Domain = (fetch: typeof fetcher, file: typeof fetcher) => Partial<DomainRepositories>
    const domains = import.meta.glob<Record<string, Domain>>('../../app/lib/repositories/domains/*.ts')
    const real: Partial<DomainRepositories> = {}
    for (const load of Object.values(domains)) {
      for (const factory of Object.values(await load()))
        Object.assign(real, factory(fetcher, fetcher))
    }
    expect(Object.keys(exposed).sort()).toEqual(Object.keys(real).sort())
    for (const key of Object.keys(exposed) as (keyof DomainRepositories)[])
      expect(Object.keys(exposed[key]).sort(), key).toEqual(Object.keys(real[key]!).sort())
    expect(fetcher).not.toHaveBeenCalled()
  }
  finally { vi.unstubAllGlobals() }
})
