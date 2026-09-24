export default defineEventHandler((event) => {
  if (event.path.startsWith('/api/read/worker-roster/') || event.path.startsWith('/api/commands/worker-roster'))
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
})
