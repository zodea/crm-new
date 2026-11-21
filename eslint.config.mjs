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
      'src-tauri/gen/**',
      'src-tauri/target/**',
    ],
  }),
  {
    name: 'crm/vitest-assertions',
    files: ['tests/**/*.ts'],
    rules: {
      'test/require-to-throw-message': 'error',
      'test/no-restricted-matchers': ['error', {
        'rejects.toBeDefined': '请断言具体的拒绝原因。',
      }],
    },
  },
  {
    name: 'crm/e2e-assertions',
    files: ['e2e/**/*.spec.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        'TSEnumDeclaration[const=true]',
        'TSExportAssignment',
        {
          selector: 'CallExpression[callee.property.name="toThrow"][arguments.length=0]',
          message: '请断言具体的错误原因。',
        },
        {
          selector: 'CallExpression[callee.property.name="toBeDefined"][callee.object.property.name="rejects"]',
          message: '请断言具体的拒绝原因。',
        },
        {
          selector: 'CallExpression[callee.name="test"] > :matches(ArrowFunctionExpression, FunctionExpression)[body.body.length=0]',
          message: '测试必须验证可观察的行为。',
        },
      ],
    },
  },
)
