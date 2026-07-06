// 应用侧共享 db 门面(SoftDb 形状),供 store/组件传给 lib/db 的纯函数。
// 单独成文件:soft-delete.ts 保持零运行时依赖(node 可测),connection.ts 归 typecheck 修复会话所有。
import type { SoftDb } from './soft-delete'
import { execute, select } from './connection'

export const db: SoftDb = { execute, select }
