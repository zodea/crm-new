import { onScopeDispose } from 'vue'
import { deriveKey } from '~/lib/tabs/tab-machine'

/** 守卫随页面实例释放；停用的 KeepAlive 页面仍须保护未保存输入。 */
export function useTabCloseGuard(guard: () => boolean | Promise<boolean>) {
  const key = deriveKey(useRoute().fullPath)
  const dispose = useTabsStore().registerCloseGuard(key, guard)
  onScopeDispose(dispose)
}
