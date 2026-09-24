import { nextTick } from 'vue'
import { loadReceiptSourceOrigin } from '~/lib/receipt/return-context'

/** 来源页在自身事实回读后恢复收款穿透前的位置，存储不参与记录归属。 */
export function useReceiptSourceReturn() {
  return async function restore(fullPath: string, horizontalRegion?: HTMLElement | null) {
    const stored = loadReceiptSourceOrigin(fullPath)
    if (!stored)
      return false
    const hash = new URL(fullPath, 'https://ruihang.invalid').hash
    let anchor: string
    try {
      anchor = decodeURIComponent(hash.slice(1))
    }
    catch { return false }
    await nextTick()
    const target = document.getElementById(anchor)
    if (!target || !target.getClientRects().length)
      return false
    const workspace = document.querySelector<HTMLElement>('[data-shell-workspace]')
    if (workspace)
      workspace.scrollTop = stored.scrollTop
    if (horizontalRegion)
      horizontalRegion.scrollLeft = stored.scrollLeft
    target.focus({ preventScroll: true })
    return true
  }
}
