# 瑞航 CRM 设计系统运行时

本目录属于当前 Claude Design `app` 界面的运行时资产，提供 bundle、CSS、字体与设计令牌。

## 当前范围

- 唯一应用入口：`DC重构设计源码/app.dc.html`
- 屏幕与交互源码：`DC重构设计源码/kit/**/*.jsx`
- 内容区令牌：`tokens/content-v5.css`
- 响应式与自适应契约：`docs/adr/0013-align-all-ui-to-online-design.md`
- 设计文档唯一入口：`docs/design/README.md`

本文件不再保存早期“扫描件助手”的模块、固定画布或视觉说明。那些内容不属于当前瑞航 CRM `app`，需要追溯时请查看 Git 历史。

不要直接复制本目录中的 bundle 代码到 Nuxt；生产端通过令牌桥接和对应 Vue 组件消费设计语义。
