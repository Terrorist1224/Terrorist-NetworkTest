$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$innoCompiler = Join-Path $env:ProgramFiles 'Inno Setup 7\ISIDE.exe'
$installerScript = Join-Path $projectRoot 'installer\setup.iss'
$appPayload = Join-Path $projectRoot 'release\win-unpacked\TerroristNetWorkTest.exe'
$installerOutput = Join-Path $projectRoot 'release\Terrorist NetworkTest 1.2.0.exe'
$tempRoot = [System.IO.Path]::GetPathRoot([System.IO.Path]::GetTempPath())
$compileTimeoutMs = 15 * 60 * 1000

if (-not (Test-Path -LiteralPath $innoCompiler -PathType Leaf)) {
  throw "Inno Setup 7 Compiler IDE was not found: $innoCompiler"
}
if (-not (Test-Path -LiteralPath $installerScript -PathType Leaf)) {
  throw "Inno Setup script was not found: $installerScript"
}
if (-not (Test-Path -LiteralPath $appPayload -PathType Leaf)) {
  throw "Electron app payload was not found: $appPayload"
}
if (-not [string]::Equals($tempRoot, 'C:\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Windows TEMP is on '$tempRoot'. Set TEMP and TMP to a C: path before packaging; the installer runtime uses the Windows temporary directory."
}

$installerDirectory = Split-Path -Parent $installerScript
$compilerProcess = Start-Process `
  -FilePath $innoCompiler `
  -ArgumentList @('-cc', 'setup.iss') `
  -WorkingDirectory $installerDirectory `
  -WindowStyle Hidden `
  -PassThru

if (-not $compilerProcess.WaitForExit($compileTimeoutMs)) {
  Stop-Process -Id $compilerProcess.Id -Force -ErrorAction SilentlyContinue
  throw 'Inno Setup compilation exceeded the 15-minute timeout.'
}
if ($compilerProcess.ExitCode -ne 0) {
  throw "Inno Setup compilation failed with exit code $($compilerProcess.ExitCode)."
}

if (-not (Test-Path -LiteralPath $installerOutput -PathType Leaf)) {
  throw "Inno Setup did not produce the expected installer: $installerOutput"
}

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$installerStream = [System.IO.File]::OpenRead($installerOutput)
try {
  $hashBytes = $sha256.ComputeHash($installerStream)
  $installerHash = [System.BitConverter]::ToString($hashBytes).Replace('-', '')
} finally {
  $installerStream.Dispose()
  $sha256.Dispose()
}
Write-Output "Installer: $installerOutput"
Write-Output "SHA256: $installerHash"
