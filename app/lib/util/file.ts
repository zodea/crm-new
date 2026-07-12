// 文件大小的人类可读格式化——上传建行等处共用的唯一实现,
// 单位阈值/小数位只此一处,避免多入口各写一份导致同列表里「1.5 MB」「1536 KB」两种口径混出。
export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
