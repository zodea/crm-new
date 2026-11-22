import type { H3Event } from 'h3'
import { createProductionOwnerDocumentMigration } from './production-owner-document-migration'
import { createProductionOwnerDocumentService } from './production-owner-document-service'
import { productionRuntime, productionSession } from './production-runtime'

const owners = new WeakMap<object, ReturnType<typeof createProductionOwnerDocumentService>>()
const migrations = new WeakMap<object, ReturnType<typeof createProductionOwnerDocumentMigration>>()
/** All commercial kinds share the existing disk authority and transaction coordinator. */
export function productionOwnerDocumentRuntime(event: H3Event) {
  const runtime = productionRuntime()
  if (!runtime)
    return null
  let owner = owners.get(runtime.storage)
  if (!owner) {
    owner = createProductionOwnerDocumentService(runtime.storage)
    owners.set(runtime.storage, owner)
  }
  const session = productionSession(event)
  let migration = migrations.get(runtime.storage)
  if (!migration) {
    migration = createProductionOwnerDocumentMigration(runtime.storage)
    migrations.set(runtime.storage, migration)
  }
  return {
    context: (kind: Parameters<typeof owner.context>[0]) => owner!.context(kind, session),
    list: (kind: Parameters<typeof owner.list>[0], query: Parameters<typeof owner.list>[1]) => owner!.list(kind, query, session),
    detail: (kind: Parameters<typeof owner.detail>[0], id: string, query: Parameters<typeof owner.detail>[2]) => owner!.detail(kind, id, query, session),
    form: (kind: Parameters<typeof owner.form>[0], id: string, includeDeleted = false) => owner!.form(kind, id, session, includeDeleted),
    boqLines: (scope: Parameters<typeof owner.boqLines>[0]) => owner!.boqLines(scope, session),
    execute: (command: Parameters<typeof owner.execute>[0]) => owner!.execute(command, session),
    resolve: (kind: Parameters<typeof owner.resolve>[0], descriptor: Parameters<typeof owner.resolve>[1]) => owner!.resolve(kind, descriptor, session),
    file: (scope: Parameters<typeof owner.file>[0]) => owner!.file(scope, session),
    migration: {
      state: () => migration!.state(session),
      preflight: (input: unknown) => migration!.preflight(input, session),
      adopt: (input: unknown) => migration!.adopt(input, session),
      restore: (input: unknown) => migration!.restore(input, session),
      resolve: (input: unknown) => migration!.resolve(input, session),
    },
  }
}
