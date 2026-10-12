import { useBrowserQuantityStore } from './quantity-browser'

/** 运行环境在入口确定，正式浏览器不会建立本地写入 store。 */
export function useQuantityStore() {
  return useBrowserQuantityStore()
}
