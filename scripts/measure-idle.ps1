param([int]$Seconds = 60, [string]$Output = '.tmp\idle-performance.csv')

$resolved = [System.IO.Path]::GetFullPath((Join-Path (Get-Location) $Output))
$workspace = [System.IO.Path]::GetFullPath((Get-Location).Path)
if (-not $resolved.StartsWith($workspace + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output must stay inside the workspace.'
}
$directory = Split-Path -Parent $resolved
New-Item -ItemType Directory -Force $directory | Out-Null
$cores = [Environment]::ProcessorCount
$rows = [System.Collections.Generic.List[object]]::new()
$previous = $null
for ($i = 0; $i -lt $Seconds; $i++) {
  $processes = @(Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$workspace*" })
  $cpuSeconds = ($processes | Measure-Object -Property CPU -Sum).Sum
  $privateBytes = ($processes | Measure-Object -Property PrivateMemorySize64 -Sum).Sum
  $now = Get-Date
  $cpuPercent = if ($previous) { [math]::Max(0, ($cpuSeconds - $previous.CpuSeconds) / ($now - $previous.At).TotalSeconds / $cores * 100) } else { 0 }
  $rows.Add([pscustomobject]@{ At = $now.ToString('o'); ProcessCount = $processes.Count; CpuPercent = [math]::Round($cpuPercent, 3); PrivateMB = [math]::Round($privateBytes / 1MB, 1) })
  $previous = [pscustomobject]@{ At = $now; CpuSeconds = $cpuSeconds }
  Start-Sleep -Seconds 1
}
$rows | Export-Csv -LiteralPath $resolved -NoTypeInformation -Encoding utf8
$measured = @($rows | Select-Object -Skip 1)
if ($measured.Count) {
  [pscustomobject]@{
    Samples = $measured.Count
    AverageCpuPercent = [math]::Round(($measured | Measure-Object -Property CpuPercent -Average).Average, 3)
    PeakPrivateMB = [math]::Round(($measured | Measure-Object -Property PrivateMB -Maximum).Maximum, 1)
    Output = $resolved
  }
}
