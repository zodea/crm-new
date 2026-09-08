import process from 'node:process'
import { resetOtherSettlementInstance } from '../../../utils/other-settlement-runtime'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404 })
  const key = getHeader(event, 'x-ruihang-test-session')
  if (getHeader(event, 'x-ruihang-test-reset') !== '1' || !key)
    throw createError({ statusCode: 403 })
  const body = await readBody(event)
  if (!['ready', 'empty', 'related', 'forbidden', 'unavailable'].includes(body?.scenario))
    throw createError({ statusCode: 400 })
  await resetOtherSettlementInstance(key, body.scenario)
  return { ok: true }
})
