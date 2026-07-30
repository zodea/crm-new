import { invoke, isTauri } from '@tauri-apps/api/core'

export async function openExternalUrl(url: string): Promise<boolean> {
  if (isTauri()) {
    await invoke('open_external_url', { url })
    return true
  }
  return window.open(url, '_blank', 'noopener,noreferrer') != null
}
