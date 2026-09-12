import { credentialProblem } from '../../app/lib/supplier/credential-contract'
import { resolveOcrRuntimeOptions } from './ocr-runtime-options'
import { PaddleOcrCloudClient, PaddleOcrCloudError } from './paddleocr-cloud'
import { supplierCommandTestInstance } from './supplier-command-test-instance'
import { createSupplierCredentialOcrService } from './supplier-credential-ocr-service'

export const supplierCredentialOcrService = createSupplierCredentialOcrService({ read: supplierCommandTestInstance.readCredentialScope, transact: supplierCommandTestInstance.transactCredentialScope }, {
  async recognize(input) {
    const config = useRuntimeConfig()
    const resolved = resolveOcrRuntimeOptions(input.options, { requestTimeoutMs: config.paddleOcrRequestTimeoutMs, pollTimeoutMs: config.paddleOcrPollTimeoutMs })
    try {
      const client = new PaddleOcrCloudClient({ accessToken: String(config.paddleOcrAccessToken || ''), baseUrl: String(config.paddleOcrBaseUrl || ''), requestTimeoutMs: resolved.requestTimeoutMs, pollTimeoutMs: resolved.pollTimeoutMs })
      return await client.recognize({ ...input, options: resolved.documentOptions })
    }
    catch (cause) {
      if (cause instanceof PaddleOcrCloudError)
        throw credentialProblem('unavailable', cause.code === 'missing-token' ? '尚未配置 OCR 服务，请先完成现有 OCR 设置；已上传原件会保留' : `识别未完成：${cause.message}。已上传原件会保留，可稍后重试或手工维护`)
      throw cause
    }
  },
})
