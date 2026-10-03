import { defineConfig } from 'node-modules-inspector'

export default defineConfig({
  // 重复版本检查只读取本地依赖树，不需要查询 npm 发布元数据。
  fetchNpmMeta: false,
})
