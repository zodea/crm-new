$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$verificationRoot = Join-Path $projectRoot 'output/lan-verification'
$configPath = Join-Path $verificationRoot 'settings.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw '隔离验证配置不存在，请先完成本机初始化。'
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$pidPath = Join-Path $verificationRoot 'service.pid'
if (Test-Path -LiteralPath $pidPath -PathType Leaf) {
  $oldId = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$oldId)) {
    $old = Get-CimInstance Win32_Process -Filter "ProcessId = $oldId"
    if ($old -and $old.CommandLine -like '*lan-verification-proxy.mjs*') {
      throw '隔离验证服务已经运行。'
    }
  }
}
$env:CRM_LAN_TEST_ORIGIN = $config.origin
$env:CRM_LAN_TEST_CERT = Join-Path $verificationRoot 'certificate.pem'
$env:CRM_LAN_TEST_KEY = Join-Path $verificationRoot 'private-key.pem'
$env:CRM_DATA_DIRECTORY = Join-Path $verificationRoot 'data'
$env:CRM_ACCESS_CODE_HASH = $config.accessCodeHash
$node = (Get-Command node.exe -ErrorAction Stop).Source
$entry = Join-Path $projectRoot 'scripts/lan-verification-proxy.mjs'
$proc = Start-Process -FilePath $node -ArgumentList @("`"$entry`"") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru
Set-Content -LiteralPath $pidPath -Value $proc.Id -Encoding ascii
$health = 'const h=require("node:https"),f=require("node:fs");let n=0;function check(){const q=h.get(process.env.CRM_LAN_TEST_ORIGIN+"/api/auth/status",{ca:f.readFileSync(process.env.CRM_LAN_TEST_CERT),timeout:2000},r=>{let s="";r.on("data",x=>s+=x);r.on("end",()=>{try{const v=JSON.parse(s);if(r.statusCode===200&&v.mode==="production"&&v.purpose==="verification")return;retry()}catch{retry()}})});q.on("error",retry);q.on("timeout",()=>q.destroy())}function retry(){if(++n>=60)process.exit(1);setTimeout(check,500)}check()'
& $node -e $health
if ($LASTEXITCODE -ne 0) {
  throw '隔离验证服务未能通过加密健康检查。'
}
Write-Output "验证服务已就绪，入口 $($config.origin)。"
