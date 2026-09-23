import { productionBackupRuntime } from '../utils/production-backup-runtime'

export default defineNitroPlugin((app) => {
  let closing = false
  let pending: Promise<void> | null = null
  function tick() {
    if (closing || pending)
      return
    pending = Promise.resolve().then(async () => {
      await productionBackupRuntime()?.scheduled()
    }).catch(() => {
      // Durable failed attempts appear in status. Invalid configuration is surfaced by the status endpoint.
      // Never log access configuration, storage paths or original document contents.
    }).finally(() => { pending = null })
  }
  // Wall clock due checks also catch up after Windows sleep. Timers themselves do not define data freshness.
  const timer = setInterval(tick, 60_000)
  timer.unref()
  tick()
  app.hooks.hook('close', async () => {
    closing = true
    clearInterval(timer)
    await pending
  })
})
