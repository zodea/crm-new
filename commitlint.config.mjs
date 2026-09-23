export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // 中文说明允许包含 Nuxt、API 等专有名词，不强制英文句式大小写。
    'subject-case': [0],
  },
}
