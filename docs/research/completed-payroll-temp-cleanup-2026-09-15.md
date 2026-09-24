# P4、P5 完成后的临时文件回收

2026-09-15 03:41，在已完成的 P5 登记提交 `e344a5444cd52bfeb65e78b031912d5241666fc0` 后，将以下两个明确属于本轮 Codex 的临时目录移入 **Windows 回收站**，未永久删除。完整回执见[清理记录](./completed-payroll-temp-cleanup-2026-09-15.json)。

| 已回收目录（仓库相对路径） | 文件数 | 字节数 |
| --- | ---: | ---: |
| `.tmp/remaining-issues-20260910/payroll-p4-central` | 101 | 1,044,283 |
| `.tmp/remaining-issues-20260910/payroll-p5-central` | 114 | 4,390,086 |
| 合计 | 215 | 5,434,369 |

内容为已完成阶段的测试日志、临时脚本、复核索引和已归档页图副本。最后一次 P5 正常提交检查日志先归档到[原验收目录](../design/evidence/issue-412-payroll-fees/checks/registration/commit-registration.log)，再核对源文件与归档文件 SHA-256 一致。

执行前及执行时均检查完整绝对路径、全部祖先和后代的重解析属性、Git 跟踪状态、活动进程引用及文件独占读取；逐份文件的大小、SHA-256 与封存计划一致才回收。没有数据库、未分类文件或活动进程目标。正式证据、P6 活动资料、其他工作树及用户指定的外部交接文件没有处理。

这些文件可从 Windows 回收站恢复到原位置。同盘回收不代表可用磁盘空间增加。此前旧指南及旧工资打印 PDF 的清理独立见[PDF 清理记录](./guide-pdf-cleanup-2026-09-14.md)，当前操作说明继续使用 Markdown。
