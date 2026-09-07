param(
  [string]$PackagePath
)

$ErrorActionPreference = 'Stop'

function Resolve-PackagePath {
  param([string]$RequestedPath)

  if ($RequestedPath) {
    return (Resolve-Path -LiteralPath $RequestedPath).Path
  }

  $candidates = @(Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..') -Filter 'hrhy-ai-codespec-*.tgz' -File)
  if ($candidates.Count -ne 1) {
    throw "请通过 -PackagePath 指定唯一的 hrhy-ai-codespec-*.tgz 文件。"
  }
  return $candidates[0].FullName
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw '未找到 Node.js。请先安装 Node.js 20.19.0 或更高版本。'
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw '未找到 npm。请确认 npm 已加入 PATH。'
}

$nodeVersion = (& node --version).Trim()
$match = [regex]::Match($nodeVersion, '^v(?<version>\d+\.\d+\.\d+)')
if (-not $match.Success -or ([version]$match.Groups['version'].Value -lt [version]'20.19.0')) {
  throw "当前 Node.js 版本为 $nodeVersion，需要 20.19.0 或更高版本。"
}

$resolvedPackage = Resolve-PackagePath -RequestedPath $PackagePath
Write-Host "使用离线包安装：$resolvedPackage"
& npm install -g $resolvedPackage --offline --no-audit --no-fund
exit $LASTEXITCODE
