. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $repo
$task = Get-DashboardTask
$state = if ($task) { $task.State } else { 'Not installed' }
Write-Host "Scheduled task: $state"
$health = Get-DashboardHealth
if ($health) {
    Write-Host ("Health: " + ($health | ConvertTo-Json -Compress))
} else {
    Write-Host "Health: unavailable at $healthUrl"
}
$directory = Get-DataDirectory
Write-Host "Data folder: $directory"
$log = Join-Path $directory 'logs\dashboard.log'
if (Test-Path -LiteralPath $log) {
    Write-Host 'Last 20 log lines:'
    Get-Content -LiteralPath $log -Tail 20 -Encoding UTF8
} else {
    Write-Host 'No dashboard log yet.'
}
