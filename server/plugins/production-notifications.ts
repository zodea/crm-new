import { productionNotificationRuntime } from '../utils/production-notification-runtime'

export default defineNitroPlugin((app) => {
  let closing = false
  let pending: Promise<void> | null = null
  function tick() {
    if (closing || pending)
      return
    pending = Promise.resolve().then(async () => {
      await productionNotificationRuntime()?.notifications.scheduled()
    }).catch(() => {
      // Inbox reports evaluationState unavailable; never log source paths or original content.
    }).finally(() => { pending = null })
  }
  const timer = setInterval(tick, 60_000)
  timer.unref()
  tick()
  app.hooks.hook('close', async () => {
    closing = true
    clearInterval(timer)
    await pending
  })
})
