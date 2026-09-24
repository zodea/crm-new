import { defineConfig } from 'dpdm'

export default defineConfig({
  // 检查显式 TypeScript 依赖；Nuxt 自动导入与 Vue 模板不属于此扫描范围。
  files: ['app/lib/**/*.ts', 'app/stores/**/*.ts', 'app/composables/**/*.ts', 'server/**/*.ts'],
  tsconfig: '.nuxt/tsconfig.app.json',
  transform: true,
  tree: false,
  exitCode: 'circular:1',
})
