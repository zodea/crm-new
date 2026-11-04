import { expect, it, vi } from 'vitest'
import { PaddleOcrCloudClient } from '../../server/utils/paddleocr-cloud'

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const input = { fileName: '合成.png', contentType: 'image/png', data: new Uint8Array([1]) }

function delayedPoll(delay: number) {
  let aborted = false
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST')
      return json({ code: 0, data: { jobId: 'synthetic-job' } })
    if (String(url).includes('/jobs/')) {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(json({ code: 0, data: { state: 'done', resultUrl: { jsonUrl: 'https://result.example/result.jsonl' } } })), delay)
        init?.signal?.addEventListener('abort', () => {
          aborted = true
          clearTimeout(timer)
          reject(new DOMException('aborted', 'AbortError'))
        }, { once: true })
      })
    }
    return new Response(JSON.stringify({ result: { layoutParsingResults: [{ markdown: { text: '合成' } }] } }))
  })
  return { fetchMock, wasAborted: () => aborted }
}

it('轮询剩余总时限短于单次请求时中断请求并报告轮询超时', async () => {
  const source = delayedPoll(100)
  const client = new PaddleOcrCloudClient({ accessToken: 'synthetic-token', requestTimeoutMs: 250, pollTimeoutMs: 25, fetch: source.fetchMock })
  await expect(client.recognize(input)).rejects.toMatchObject({ code: 'poll-timeout', retryable: true })
  expect(source.wasAborted()).toBe(true)
  expect(source.fetchMock).toHaveBeenCalledTimes(2)
})

it('单次请求时限先到仍报告请求超时', async () => {
  const source = delayedPoll(100)
  const client = new PaddleOcrCloudClient({ accessToken: 'synthetic-token', requestTimeoutMs: 25, pollTimeoutMs: 250, fetch: source.fetchMock })
  await expect(client.recognize(input)).rejects.toMatchObject({ code: 'request-timeout', retryable: true })
  expect(source.wasAborted()).toBe(true)
})

it('超过轮询总时限才到达的完成状态不能当作成功', async () => {
  let clock = 0
  const progress: number[] = []
  const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
    if (init?.method === 'POST')
      return json({ code: 0, data: { jobId: 'synthetic-job' } })
    clock = 26
    return json({ code: 0, data: { state: 'done', resultUrl: { jsonUrl: 'https://result.example/result.jsonl' } } })
  })
  const client = new PaddleOcrCloudClient({ accessToken: 'synthetic-token', requestTimeoutMs: 250, pollTimeoutMs: 25, fetch: fetchMock, now: () => clock })
  await expect(client.recognize({ ...input, onProgress: value => progress.push(value) })).rejects.toMatchObject({ code: 'poll-timeout', retryable: true })
  expect(progress).toEqual([0])
  expect(fetchMock).toHaveBeenCalledTimes(2)
})
