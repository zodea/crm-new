import { supplierCommandTestInstance } from './supplier-command-test-instance'
import { recognizeSupplierCredential } from './supplier-credential-ocr-provider'
import { createSupplierCredentialOcrService } from './supplier-credential-ocr-service'

export const supplierCredentialOcrService = createSupplierCredentialOcrService({ read: supplierCommandTestInstance.readCredentialScope, transact: supplierCommandTestInstance.transactCredentialScope }, { recognize: recognizeSupplierCredential })
