import { createError, defineEventHandler, getHeader, readBody } from 'h3'
import { loginProductionOwner } from '../../utils/production-auth'

export default defineEventHandler(async (event) => {
  const length = Number(getHeader(event, 'content-length'))
  if (getHeader(event, 'content-type')?.split(';')[0] !== 'application/json' || !Number.isSafeInteger(length) || length < 2 || length > 4096)
    throw createError({ statusCode: 400, message: '登录请求格式不正确。' })
  return loginProductionOwner(event, await readBody(event))
})
