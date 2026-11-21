import process from 'node:process'

export function isolatedDevServer(port: number, visualProfile = '') {
  return {
    name: `nuxt-${port}`,
    command: `node ./node_modules/nuxt/bin/nuxt.mjs dev --host 127.0.0.1 --port ${port} --no-fork --extends ./e2e/helpers/nuxt-layer`,
    env: {
      CRM_RUN_MODE: 'development',
      CRM_E2E_SERVER_PORT: String(port),
      CRM_E2E_RUN_ID: String(process.pid),
      NUXT_DEVTOOLS: 'false',
      NUXT_IGNORE_LOCK: '1',
      NUXT_PUBLIC_VISUAL_BASELINE_MODE: visualProfile,
    },
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 180_000,
  }
}
