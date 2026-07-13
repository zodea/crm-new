import type { Component } from 'vue'
import { defineComponent, h } from 'vue'

const tabPageBase = Symbol('tab-page-base')
const wrapperRegistry = new WeakMap<object, Map<string, Component>>()
const tabWrapperRegistries = new Set<Map<string, Component>>()

type TabPageWrapper = Component & {
  [tabPageBase]?: Component
}

/** KeepAlive 的 include 只认组件名；为每个页签生成稳定且可匹配的唯一名。 */
export function tabPageCacheName(tabKey: string): string {
  let hash = 2166136261
  for (let index = 0; index < tabKey.length; index++) {
    hash ^= tabKey.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `TabPage${(hash >>> 0).toString(36)}_${tabKey.length}`
}

export function unwrapTabPageComponent(component: Component): Component {
  return (component as TabPageWrapper)[tabPageBase] ?? component
}

/**
 * 同一路由组件按页签包一层唯一命名组件，使 KeepAlive 可定向 prune 参数页签。
 * registry 保证再次进入同一页签时组件 type 稳定，从而命中原缓存。
 */
export function getTabPageWrapper(baseComponent: Component, tabKey: string): Component {
  const base = unwrapTabPageComponent(baseComponent)
  const registryKey = base as object
  let byTab = wrapperRegistry.get(registryKey)
  if (!byTab) {
    byTab = new Map()
    wrapperRegistry.set(registryKey, byTab)
    tabWrapperRegistries.add(byTab)
  }

  const cached = byTab.get(tabKey)
  if (cached)
    return cached

  const wrapper = defineComponent({
    name: tabPageCacheName(tabKey),
    inheritAttrs: false,
    setup(_, { attrs, slots }) {
      return () => h(base, attrs, slots)
    },
  }) as TabPageWrapper
  Object.defineProperty(wrapper, tabPageBase, { value: base })
  byTab.set(tabKey, wrapper)
  return wrapper
}

/** KeepAlive 完成定向卸载后，同步释放已关闭页签的轻量 wrapper 定义。 */
export function pruneTabPageWrappers(validTabKeys: string[]) {
  const valid = new Set(validTabKeys)
  for (const registry of tabWrapperRegistries) {
    for (const key of registry.keys()) {
      if (!valid.has(key))
        registry.delete(key)
    }
  }
}
