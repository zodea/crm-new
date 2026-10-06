import type { ProblemDTO } from '~/types/read-model'
import { createServer } from 'node:http'
import { createApp, createError, defineEventHandler, getQuery, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { readConstructionContractHttp } from '~/lib/construction-contract/http-repository'
import { readCrewWorkerHttp } from '~/lib/crew-worker/http-repository'
import { readCustomerHttp } from '~/lib/customer/http-repository'
import { createHttpOwnerCommercialDocumentReadRepository } from '~/lib/owner-document/central-http-repository'
import { createHttpProjectSupplierReadRepository } from '~/lib/project-supplier/http-repository'
import { readProjectHttp } from '~/lib/project/http-repository'
import { readFailureState, readStateData } from '~/lib/read-model/state'
import { readSubcontractContractHttp } from '~/lib/subcontract-contract/http-repository'
import { MigrationEvidenceProblem } from '../../server/utils/migration-snapshot'
import { throwProductionStorageError } from '../../server/utils/production-runtime'

const readers = [
  ['customer', readCustomerHttp],
  ['project', readProjectHttp],
  ['crew-worker', readCrewWorkerHttp],
  ['construction-contract', readConstructionContractHttp],
  ['subcontract-contract', readSubcontractContractHttp],
] as const

it('实际迁入证据错误经共同HTTP边界保留校验、权限及过期原因，不退化为未知服务异常', async () => {
  const cases = [['validation-failed', 422], ['forbidden', 403], ['stale-source', 409], ['unavailable', 503]] as const
  const server = createServer(toNodeListener(createApp().use(defineEventHandler((event) => {
    const code = getQuery(event).code as typeof cases[number][0]
    throwProductionStorageError(new MigrationEvidenceProblem(code, `迁入证据拒绝：${code}`))
  }))))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('迁入 HTTP 测试未返回端口')
    for (const [code, status] of cases) {
      const response = await fetch(`http://127.0.0.1:${address.port}/read?code=${code}`)
      expect(response.status).toBe(status)
      const body = await response.json()
      expect(body.data).toEqual({ code, message: `迁入证据拒绝：${code}`, retryable: false, fieldErrors: {}, traceId: null })
    }
  }
  finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
})

describe('实际 HTTP 读取失败到公共状态的边界', () => {
  it('各读取适配器将401/403清除旧事实；503保留原范围事实且没有空集合假象', async () => {
    const server = createServer(toNodeListener(createApp().use(defineEventHandler((event) => {
      const query = getQuery(event)
      const status = Number(query.status)
      const valid = query.bad !== 'true'
      throw createError({
        statusCode: status,
        data: valid
          ? { code: status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'unavailable', message: '真实读取失败', retryable: status === 503, fieldErrors: {}, traceId: 'wire-read-trace' }
          : { code: 'unavailable', message: '敏感坏载荷', fieldErrors: [] },
      })
    }))))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('实际 HTTP 测试未返回端口')
      for (const [status, bad] of [[401, false], [401, true], [403, true], [503, false]] as const) {
        const request = async () => {
          const response = await fetch(`http://127.0.0.1:${address.port}/read?status=${status}&bad=${bad}`)
          const body = await response.json()
          if (!response.ok)
            throw Object.assign(new Error('HTTP读取被拒绝'), { response: { status: response.status, _data: body } })
          return body
        }
        const decode = vi.fn(value => value)
        const requests: readonly [string, () => Promise<unknown>][] = [
          ...readers.map(([domain, read]) => [domain, () => read(request, decode)] as const),
          ['owner-document', () => createHttpOwnerCommercialDocumentReadRepository({ fetcher: request }).get({ kind: 'owner_change', id: 'owner-a', origin: 'real', includeDemo: false, variant: null })],
          ['project-supplier', () => createHttpProjectSupplierReadRepository({ fetcher: request }).get({ projectId: 'project-a', supplierId: 'supplier-a', origin: 'real', includeDemo: false })],
        ]
        for (const [domain, read] of requests) {
          const failure = await read().then(() => {
            throw new Error(`${domain}错误地读取成功`)
          }, error => error as { problem: ProblemDTO })
          expect(failure.problem.code, `${domain}/${status}`).toBe(status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' : 'unavailable')
          expect(failure.problem.retryable).toBe(status === 503)
          const previous = { id: 'authorized-old-record', value: '0.00' }
          const state = readFailureState(failure.problem, previous)
          expect(readStateData(state), `${domain}/${status}`).toEqual(status === 503 ? previous : null)
          expect(state.kind).toBe(status === 503 ? 'unavailable' : 'forbidden')
          if (bad)
            expect(JSON.stringify(state)).not.toContain('敏感坏载荷')
        }
        expect(decode).not.toHaveBeenCalled()
      }
    }
    finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})

it('命令边界只保留同原号未应用证明，读取缓存和失配/坏证明不取得清键资格', async () => {
  const failure = (id: string, commandOutcome = 'not-applied', code = 'stale-source') => ({ data: { data: { code, message: '拒绝原提交', retryable: false, fieldErrors: {}, traceId: null, commandId: id, commandOutcome, privateBody: '不得复制' } } })
  const read = (body: unknown, id?: string) => readProjectHttp(async () => {
    throw Object.assign(new Error('原命令被拒绝'), body)
  }, () => null, id).catch(cause => cause.problem)
  expect(await read(failure('original'), 'original')).toEqual({ code: 'stale-source', message: '拒绝原提交', retryable: false, fieldErrors: {}, traceId: null, commandId: 'original', commandOutcome: 'not-applied' })
  for (const body of [failure('another'), failure('original', 'unknown'), failure('original', 'not-applied', 'forbidden')])
    expect(await read(body, 'original')).not.toHaveProperty('commandOutcome')
  expect(await read(failure('original'))).not.toHaveProperty('commandOutcome')
})
