import { createBoqBuildingTestInstance } from './boq-building-test-instance'
import { ownerCommercialDocumentCommandTestInstance } from './owner-commercial-document-command-test-instance'
import { quantityTestInstance } from './quantity-runtime'

export const boqBuildingService = createBoqBuildingTestInstance(ownerCommercialDocumentCommandTestInstance, quantityTestInstance)
