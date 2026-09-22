# #444 使用指南 PDF 检查

三份指南的正式输出与本票渲染证据对应如下。页数包含封面；渲染分辨率 95 dpi。

| 指南 | 版本 | 页数 | 正式 PDF | 页面证据 |
| --- | --- | ---: | --- | --- |
| 项目启动与施工排程 | V2.8 | 9 | [下载](../../../../guides/project-start-and-schedule.md) | `schedule-1.png`～`schedule-9.png` |
| 首页项目与施工进度 | V1.2 | 3 | [下载](../../../../guides/home-project-progress.md) | `home-1.png`～`home-3.png` |
| 本地核心身份数据迁移 | V2.3 | 6 | [下载](../../../../guides/local-data-migration.md) | `migration-1.png`～`migration-6.png` |

18 页已逐页核对中文、流程步骤、表格、换页、页脚和末页内容。最终稿中与预排版完全相同的页面按 SHA-256 对照已目检原图，其余逐页重新目检；首页指南末尾曾多出仅一行的孤立页，已精简重复说明并重新渲染为三页，没有缩小字号或删去返回规则。正式复制逐张匹配临时源图哈希，记录在 [page-hashes.json](./page-hashes.json)。

最终 PDF 的 SHA-256：

- 排程：`0128ed9e0fe22f3fb65461654adbbb4fdeb371c18942ee63c9df3d502e34dac0`
- 首页：`009e47cda90674cc43eb2aae31db380b2180a30d42bb006a88bdf80ad1ef07d4`
- 迁移：`b7b338de12a957aa6d0e44eab68e0822c77db773994a1715fbba119715ec72ad`

本票覆盖中央验证环境内的使用步骤，不代表生产持久化、备份恢复与部署已经验收。后续指南更新时，以本票提交中的 PDF 与本目录图像查阅当时版本。
