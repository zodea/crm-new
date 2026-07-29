export default defineEventHandler(() => {
  throw createError({
    statusCode: 405,
    statusMessage: 'OCR settings are client-owned',
    data: {
      code: 'method-not-allowed',
      message: 'OCR 参数保存在本机应用数据库中；服务端不接收设置保存请求',
    },
  })
})
