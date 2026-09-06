import process from 'node:process'
import { resetAuxiliaryContractInstance } from '../../../utils/auxiliary-contract-runtime'

export default defineEventHandler(async (event) => {
  if (process.env.NODE_ENV === 'production')
    throw createError({ statusCode: 404 })
  const key = getHeader(event, 'x-ruihang-test-session')
  if (getHeader(event, 'x-ruihang-test-reset') !== '1' || !key)
    throw createError({ statusCode: 403 })
  const body = await readBody(event)
  if (!['ready', 'empty', 'forbidden', 'unavailable'].includes(body?.scenario))
    throw createError({ statusCode: 400 })
  await resetAuxiliaryContractInstance(key, body.scenario)
  return { ok: true }
})
