import type { F2FormKind } from '~/lib/contract/forms'
import { F2_FORM_META } from '~/lib/contract/page'
import { deriveKey } from '~/lib/tabs/tab-machine'

export function useContractFormNavigation(kind: F2FormKind) {
  const route = useRoute()
  const tabs = useTabsStore()
  const key = deriveKey(route.fullPath)
  const closeCurrent = () => tabs.close(key)

  async function openNew(resetCurrent: () => Promise<void>) {
    const path = F2_FORM_META[kind].newPath
    if (key === path) {
      await resetCurrent()
      return
    }
    // 新建页可能已有另一份草稿，必须先经过它自己的关闭确认。
    if (!await tabs.requestClose(path))
      return
    closeCurrent()
    await navigateTo({ path, query: { origin: 'real', returnTo: F2_FORM_META[kind].listPath } })
  }

  return { closeCurrent, openNew }
}
