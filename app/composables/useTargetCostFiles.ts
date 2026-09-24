import type { TargetCostContext } from '~/lib/target-cost/central-contract'
import { onScopeDispose } from 'vue'
import { toErrorMessage } from '~/lib/util/error'

export function useTargetCostFiles(options: {
  current: () => { context: TargetCostContext, targetCostId: string | null } | null
  active: () => boolean
  error: (message: string) => void
}) {
  const urls = new Set<string>()
  let sequence = 0
  async function download(fileId: string) {
    const value = options.current()
    if (!value?.targetCostId || !options.active())
      return
    const request = ++sequence
    const identity = JSON.stringify([value.context.workspaceId, value.context.actorId, value.context.origin, value.targetCostId])
    try {
      const response = await useNuxtApp().$repositories.targetCosts.file({ origin: value.context.origin }, value.targetCostId, fileId)
      const current = options.current()
      if (request !== sequence || !options.active() || !current || JSON.stringify([current.context.workspaceId, current.context.actorId, current.context.origin, current.targetCostId]) !== identity)
        return
      if (response.context.workspaceId !== value.context.workspaceId || response.context.actorId !== value.context.actorId || response.context.origin !== value.context.origin || response.content.targetCostId !== value.targetCostId || response.content.fileId !== fileId)
        throw new Error('附件不属于当前预算版本或身份')
      if (response.content.state !== 'available')
        throw new Error('此历史附件缺少原件，请在版本编辑页补传实际文件')
      const bytes = Uint8Array.from(atob(response.content.payloadBase64), value => value.charCodeAt(0))
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
      const sha256 = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (sha256 !== response.content.sha256 || (response.content.fileSize != null && bytes.byteLength !== response.content.fileSize))
        throw new Error('附件原件校验未通过，请重新读取')
      if (request !== sequence || !options.active() || options.current() !== current)
        return
      const url = URL.createObjectURL(new Blob([bytes], { type: response.content.mimeType || 'application/octet-stream' }))
      urls.add(url)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = response.content.fileName
      anchor.click()
    }
    catch (cause) {
      if (request === sequence && options.active() && options.current() === value)
        options.error(toErrorMessage(cause))
    }
  }
  onScopeDispose(() => {
    sequence += 1
    urls.forEach(url => URL.revokeObjectURL(url))
  })
  return { download }
}
