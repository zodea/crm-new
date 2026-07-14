import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

interface TauriCapability {
  permissions: string[]
}

interface TauriConfig {
  app: {
    security: {
      csp: string
      devCsp: string
    }
  }
}

async function readJson<T>(relativePath: string): Promise<T> {
  const url = new URL(`../../${relativePath}`, import.meta.url)
  return JSON.parse(await readFile(url, 'utf8')) as T
}

describe('tauri 桌面壳安全边界', () => {
  it('主窗口只开放导出与持久化数据库所需的最小命令', async () => {
    const capability = await readJson<TauriCapability>('src-tauri/capabilities/default.json')

    expect(capability.permissions).toEqual([
      'core:path:allow-join',
      'core:resources:allow-close',
      'dialog:allow-open',
      'fs:allow-exists',
      'fs:allow-mkdir',
      'fs:allow-open',
      'fs:allow-write',
      'sql:default',
      'sql:allow-execute',
    ])
  })

  it('生产与开发 WebView 都配置内容安全策略', async () => {
    const config = await readJson<TauriConfig>('src-tauri/tauri.conf.json')

    expect(config.app.security.csp).toContain('default-src \'self\'')
    expect(config.app.security.devCsp).toContain('default-src \'self\'')
  })
})
