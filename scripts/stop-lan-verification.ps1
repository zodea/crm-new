$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$pidPath = Join-Path $projectRoot 'output/lan-verification/service.pid'
if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) {
  throw '没有记录的隔离验证服务进程。'
}
$serviceId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$serviceId)) {
  throw '隔离验证服务进程编号无效。'
}
$service = Get-CimInstance Win32_Process -Filter "ProcessId = $serviceId"
if (-not $service -or $service.CommandLine -notlike '*lan-verification-proxy.mjs*') {
  throw '未找到对应的隔离验证入口，未结束其他进程。'
}
$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $serviceId" | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*/server/index.mjs*' })
Stop-Process -Id $serviceId -ErrorAction Stop
foreach ($child in $children) {
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($child.ProcessId)"
  if ($current -and $current.ParentProcessId -eq $serviceId -and $current.CommandLine -like '*/server/index.mjs*') {
    Stop-Process -Id $current.ProcessId -ErrorAction Stop
  }
}
Write-Output '隔离验证入口与后台已停止，测试数据保留。'
