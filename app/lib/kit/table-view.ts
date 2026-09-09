import type { InjectionKey } from 'vue'

/** 表格向其单元格提供只读视图状态，领域链接不依赖网格实现。 */
export interface KitTableView {
  scrollLeft: () => number
}

export const KIT_TABLE_VIEW_KEY: InjectionKey<KitTableView> = Symbol('KitTableView')
