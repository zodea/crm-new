/** 旧页签的显式激活需要恢复校验；业务列表的新导航继续走原有路由入口。 */
export function useTabNavigation() {
  const router = useRouter()
  const session = useTabSessionStore()

  async function openStoredTab(fullPath: string, options: { replace?: boolean } = {}) {
    const target = await session.restorePath(fullPath)
    if (target !== null)
      await (options.replace ? router.replace(target) : router.push(target))
  }

  return { openStoredTab }
}
