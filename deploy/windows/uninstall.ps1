. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $repo
$task = Get-DashboardTask
if ($task) {
    if ($task.State -in @('Running', 'Queued')) {
        Stop-ScheduledTask -TaskName $taskName
    }
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
$directory = Get-DataDirectory
Write-Host "Task removed. Data is still at: $directory"
