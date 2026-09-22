import { isTauri } from '@tauri-apps/api/core'
import { useBrowserQuantityStore } from './quantity-browser'
import { useNativeQuantityStore } from './quantity-native'

/** 运行环境在入口确定，正式浏览器不会建立本地写入 store。 */
export function useQuantityStore() {
  return isTauri() ? useNativeQuantityStore() : useBrowserQuantityStore()
}
