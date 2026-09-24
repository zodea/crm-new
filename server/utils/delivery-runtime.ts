import type { DeliveryReferenceFacts } from '../../app/lib/delivery-record/contract'
import { createDeliveryCommandService } from './delivery-command-service'
import { createDeliveryReadService } from './delivery-read-service'
import { projectCommandTestInstance } from './project-command-test-instance'
import { supplierCommandTestInstance } from './supplier-command-test-instance'

export function deliveryReferenceFacts(sessionId?: string | null): DeliveryReferenceFacts {
  return {
    projects: projectCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name, dataOrigin: row.dataOrigin })),
    suppliers: supplierCommandTestInstance.rows(sessionId).map(row => ({ id: row.id, name: row.name, dataOrigin: row.dataOrigin, aliases: [...row.aliases ?? []] })),
  }
}

/** 当前浏览器中央测试实例；生产重启持久化仍由 ADR 0020 后置工作承接。 */
export const deliveryCommandTestInstance = createDeliveryCommandService({ references: deliveryReferenceFacts })
export const deliveryReadTestInstance = createDeliveryReadService(deliveryCommandTestInstance)
