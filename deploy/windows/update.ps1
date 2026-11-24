. "$PSScriptRoot\common.ps1"
Set-Location -LiteralPath $repo
try {
    Publish-Dashboard -Pull
} catch {
    Write-Error -ErrorAction Continue "Update failed. $_"
    exit 1
}
