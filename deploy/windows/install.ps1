. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $repo
try {
    Publish-Dashboard
} catch {
    Write-Error -ErrorAction Continue "Installation failed. $_"
    exit 1
}
