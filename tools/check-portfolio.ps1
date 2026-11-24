# Run every check in one Node process with child processes denied.
$project = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $project
try {
    & node --permission --allow-fs-read=. --test --test-isolation=none tools/check-intro.cjs tools/check-station.cjs tools/check-radar.cjs
    $result = $LASTEXITCODE
} finally {
    Pop-Location
}
exit $result
