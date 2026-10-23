# Prints the current Solace LAN URL, compares it with the URL logged at the
# last server start, copies it to the clipboard, and opens the app. Run by the
# `Solace URL` desktop shortcut with -NoExit so the output stays readable.
$ErrorActionPreference = "Stop"

$port = 3000
$tabletUrl = "http://localhost:$port/tablet"
$logFile = Join-Path $env:LOCALAPPDATA "Solace\logs\solace-serve.log"
$urlPattern = 'http://\d{1,3}(?:\.\d{1,3}){3}:\d{1,5}'

$currentUrl = $null
$fromLog = $false

# The live /tablet page is the authoritative source; ask it first.
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $tabletUrl -TimeoutSec 5
  $match = [regex]::Match($response.Content, $urlPattern)
  if ($match.Success) {
    $currentUrl = $match.Value
  }
} catch {
  $currentUrl = $null
}

# Fall back to the URL the supervisor logged at the last server start.
$lastStartUrl = $null
if (Test-Path $logFile) {
  $startMatches = @(Select-String -Path $logFile -Pattern "tablet URL:\s*($urlPattern)")
  if ($startMatches.Count -gt 0) {
    $lastStartUrl = $startMatches[-1].Matches[0].Groups[1].Value
  }
}

if (-not $currentUrl) {
  if ($lastStartUrl) {
    $currentUrl = $lastStartUrl
    $fromLog = $true
  } else {
    Write-Host "Solace is not running or has no LAN address." -ForegroundColor Yellow
    Write-Host "Start the 'Solace Server' task or open http://localhost:$port/tablet on the laptop."
    exit 1
  }
}

$tabletPageUrl = "${currentUrl}/tablet"
$appUrl = "${currentUrl}/"

Write-Host ""
Write-Host "Solace LAN URL" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Current URL:      $currentUrl" -ForegroundColor Cyan
Write-Host "  Connection page:  $tabletPageUrl"
Write-Host "  App:              $appUrl"
Write-Host ""

if ($fromLog) {
  Write-Host "The live server did not answer; this URL is from the last server-start log entry." -ForegroundColor Yellow
  Write-Host "The live link comparison is unavailable until the server is running."
} elseif (-not $lastStartUrl) {
  Write-Host "No previous server-start URL was found in the log; the comparison is unavailable."
} elseif ($currentUrl -eq $lastStartUrl) {
  Write-Host "The link is UNCHANGED since the last server start." -ForegroundColor Green
} else {
  Write-Host "The link has CHANGED since the last server start." -ForegroundColor Yellow
  Write-Host "  Previous URL:     $lastStartUrl"
}
Write-Host ""

# Clipboard failures are warnings: the printed URL is still usable.
try {
  Set-Clipboard -Value $currentUrl
  Write-Host "Copied the current URL to the clipboard."
} catch {
  Write-Warning "could not copy the URL to the clipboard; use the address above"
}

# Browser failures are warnings too; the printed URL is still usable.
try {
  Start-Process $appUrl
  Write-Host "Opening the app in your default browser."
} catch {
  Write-Warning "could not open the app in the default browser; use the address above"
}

exit 0
