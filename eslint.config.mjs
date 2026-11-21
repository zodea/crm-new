// @ts-check
import antfu from '@antfu/eslint-config'
import withNuxt from './.nuxt/eslint.config.mjs'

// antfu 负责 lint + 格式化(stylistic 默认开启,取代 Prettier);
// withNuxt 注入 Nuxt auto-import globals 与项目专属规则。
export default withNuxt(
  antfu({
    vue: true,
    typescript: true,
    // 不启用 formatters(会内部引入 Prettier 处理 css/md);本项目不引 Prettier。
    formatters: false,
    // DC 设计稿源码(claude.ai/design 单页设计稿)= x-import 全局 React、刻意精简写法,
    // 非 Nuxt 应用代码,整体不走应用 ESLint(见 docs/dc-rebuild)。
    ignores: [
      'DC重构设计源码/**',
      '设计系统配色更新/**',
      '参考文件数据/**',
      // Tauri 生成的 schema 是工具产物，不对其应用手写 JSON 的格式规则。
      'src-tauri/gen/**',
    ],
  }),
  {
    name: 'crm/page-private-components',
    files: ['app/pages/**/_components/**/*.vue'],
    rules: {
      // Nuxt 的路由根节点约束只适用于进入路由表的页面。
      'vue/no-multiple-template-root': 'off',
    },
  },
  {
    name: 'crm/vitest-assertions',
    files: ['tests/**/*.test.{js,jsx,ts,tsx}'],
    rules: {
      // 只约束 Vitest 测试，不把 Playwright 的断言语义混进来。
      'test/valid-expect': ['error', { maxArgs: 2 }],
      'test/valid-expect-in-promise': 'error',
      'test/expect-expect': 'error',
      'test/require-to-throw-message': 'error',
      'test/no-restricted-matchers': ['error', { 'rejects.toBeDefined': '请断言具体的拒绝原因或错误码' }],
    },
  },
  ...[
    { file: 'tests/payroll/a-navigation.test.ts', helpers: ['createInspectRestorableTabPathFixture', 'createPayrollSourceContextFixture'] },
    { file: 'tests/payroll/c1-navigation.test.ts', helpers: ['createPayrollC1WorkspaceReturnFixture6', 'createPayrollC1WorkspaceReturnFixture20'] },
    { file: 'tests/payroll/central-a-fees-codec.test.ts', helpers: ['createFeeCommandReceipt'] },
    { file: 'tests/schedule/process-library-request.test.ts', helpers: ['expectInvalid'] },
  ].map(({ file, helpers }) => ({
    name: `crm/assertion-helpers/${file}`,
    files: [file],
    rules: { 'test/expect-expect': ['error', { assertFunctionNames: ['expect', ...helpers] }] },
  })),
)
