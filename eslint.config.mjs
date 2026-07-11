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
  }),
)
