$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$taskName = 'Team Dashboard'
$runtime = Join-Path $repo '.windows-runtime'
$dist = Join-Path $repo 'server\dist'
$healthUrl = 'http://127.0.0.1:3000/api/health'

function Invoke-Checked {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "$Command failed (exit $LASTEXITCODE)."
    }
}

function Get-DashboardTask {
    $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if ($task -and $task.Actions[0].WorkingDirectory -ne $repo) {
        throw "Team Dashboard is registered from a different folder: $($task.Actions[0].WorkingDirectory)"
    }
    $task
}

function Get-DataDirectory {
    param([string]$EnvModule = (Join-Path $dist 'env.js'))
    $output = & node --input-type=module -e "import {pathToFileURL} from 'node:url'; try {const {readDataDir}=await import(pathToFileURL(process.argv[1])); console.log(readDataDir());} catch(error) {console.error(error.message);process.exitCode=1}" $EnvModule
    if ($LASTEXITCODE -ne 0) { throw 'Could not read DATA_DIR. Check .env and the message above.' }
    $output
}

function Get-DashboardHealth {
    try {
        $response = Invoke-RestMethod -Uri $healthUrl -TimeoutSec 2
        if ($response.ok -eq $true -and $response.version) { $response }
    } catch {
        return
    }
}

function Wait-DashboardHealth {
    param([bool]$Ready)
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
        if ([bool](Get-DashboardHealth) -eq $Ready) { return }
        Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Dashboard health did not reach the expected state at $healthUrl. Check status.ps1."
}

function Remove-Release {
    param([string]$Path)
    if ($Path -and (Split-Path -Parent $Path) -eq $runtime -and
        (Split-Path -Leaf $Path) -match '^release-[0-9a-f]{32}$') {
        # Node unlinks npm's workspace junctions without following them.
        Invoke-Checked node @('-e', "require('node:fs').rmSync(process.argv[1], {recursive:true,force:true})", $Path)
    }
}

function Register-DashboardTask {
    param([string]$Node)
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $launcher = Join-Path $dist 'windows-task.js'
    $action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') `
        -Argument "//B //NoLogo //E:JScript `"$launcher`" `"$Node`"" -WorkingDirectory $repo
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
    $principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -Hidden -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
        -Principal $principal -Settings $settings | Out-Null
}

function Publish-Dashboard {
    param([switch]$Pull)
    $node = (Get-Command node.exe -CommandType Application).Source
    $version = & $node -p "process.versions.node + ' ' + process.arch"
    if ($version -notmatch '^20\.\d+\.\d+ x64$') { throw 'Install Node.js 20 x64, then reopen PowerShell.' }
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $lock = [IO.File]::Open((Join-Path $runtime 'deploy.lock'), 'OpenOrCreate', 'ReadWrite', 'None')
    $release = Join-Path $runtime ('release-' + [guid]::NewGuid().ToString('N'))
    $previous = "$dist.previous"
    $next = "$dist.next"
    $oldRelease = $null
    $committed = $false
    $createdNext = $false
    try {
        $task = Get-DashboardTask
        if ($Pull -and !$task) { throw 'Task is missing. Run install.ps1 first.' }
        if (Test-Path -LiteralPath $previous) { throw "Review the previous build at $previous before retrying." }
        if (!(Test-Path -LiteralPath '.env' -PathType Leaf)) { throw 'Copy .env.example to .env and fill it in first.' }
        if ($Pull) { Invoke-Checked git @('pull', '--ff-only') }

        New-Item -ItemType Directory -Path $release | Out-Null
        $archive = Join-Path $release 'source.tar'
        Invoke-Checked git @('archive', '--output', $archive, 'HEAD')
        Invoke-Checked tar.exe @('-xf', $archive, '-C', $release)
        Remove-Item -LiteralPath $archive
        Push-Location -LiteralPath $release
        try {
            Invoke-Checked npm.cmd @('ci')
            Invoke-Checked node @('-e', "const fromServer=require('node:module').createRequire(require('node:path').resolve('server/package.json')); fromServer('better-sqlite3')(':memory:').close()")
            Invoke-Checked npm.cmd @('run', 'build')
        } finally {
            Pop-Location
        }
        $built = Join-Path $release 'server\dist'
        Copy-Item -LiteralPath (Join-Path $release 'deploy\windows\run.js') -Destination (Join-Path $built 'windows-task.js')
        $directory = Get-DataDirectory (Join-Path $built 'env.js')
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
        if (Test-Path -LiteralPath $next) { throw "Remove the stale build junction at $next before retrying." }
        New-Item -ItemType Junction -Path $next -Target $built | Out-Null
        $createdNext = $true

        $task = Get-DashboardTask
        $wasRunning = $task -and $task.State -in @('Running', 'Queued')
        $registered = $false
        $started = $false
        $swapped = $false
        try {
            if ($wasRunning) {
                Stop-ScheduledTask -TaskName $taskName
                Wait-DashboardHealth $false
            } elseif (Get-DashboardHealth) {
                throw 'A dashboard is already running on port 3000. Stop it before installing.'
            }
            if (Test-Path -LiteralPath $dist) {
                $target = (Get-Item -LiteralPath $dist).Target | Select-Object -First 1
                if ($target) { $oldRelease = Split-Path -Parent (Split-Path -Parent $target) }
                [IO.Directory]::Move($dist, $previous)
            }
            [IO.Directory]::Move($next, $dist)
            $swapped = $true
            if (!$task) {
                Register-DashboardTask $node
                $registered = $true
            }
            Start-ScheduledTask -TaskName $taskName
            $started = $true
            Wait-DashboardHealth $true
            $committed = $true
        } catch {
            $failure = $_
            try {
                if ($started) { Stop-ScheduledTask -TaskName $taskName }
                if ($registered) { Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
                if ($swapped) {
                    Wait-DashboardHealth $false
                    [IO.Directory]::Delete($dist)
                }
                if (Test-Path -LiteralPath $previous) { [IO.Directory]::Move($previous, $dist) }
                if ($wasRunning) {
                    Start-ScheduledTask -TaskName $taskName
                    Wait-DashboardHealth $true
                }
            } catch {
                throw "Deployment failed: $failure. Could not restore the previous version: $_"
            }
            throw "Deployment failed: $failure. The previous build is in place."
        }
        Write-Host "Team Dashboard is running. Data folder: $directory"
    } finally {
        try {
            if ($createdNext -and (Test-Path -LiteralPath $next)) { [IO.Directory]::Delete($next) }
            if ($committed) {
                if ((Get-Item -LiteralPath $previous -ErrorAction SilentlyContinue).LinkType -eq 'Junction') {
                    [IO.Directory]::Delete($previous)
                } elseif (Test-Path -LiteralPath $previous) {
                    # A pre-existing developer build is kept on first installation.
                    [IO.Directory]::Move($previous, (Join-Path $runtime ('previous-build-' + [guid]::NewGuid())))
                }
                Remove-Release $oldRelease
            } elseif (!(Test-Path -LiteralPath $dist) -or
                ((Get-Item -LiteralPath $dist).Target -notcontains (Join-Path $release 'server\dist'))) {
                Remove-Release $release
            }
        } catch {
            Write-Warning "Could not clean up a build folder: $_"
        } finally {
            $lock.Dispose()
        }
    }
}
