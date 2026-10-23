# Solace LAN supervisor: keeps `node server/index.mjs` running for the LAN.
# Reads SOLACE_PORT (default 3000) and inherits SOLACE_DB,
# SOLACE_BACKUP_DIR, and the other server environment variables.
# Logs live in %LOCALAPPDATA%\Solace\logs.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logDir = Join-Path $env:LOCALAPPDATA "Solace\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir "solace-serve.log"

function Write-Log([string]$message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Add-Content -Path $logFile -Value $line
}

$port = 3000
if ($env:SOLACE_PORT -and $env:SOLACE_PORT -match '^\d+$') {
  $port = [int]$env:SOLACE_PORT
}

# Duplicate guard. A refused connection is normal and must not throw.
$inUse = $false
$client = [System.Net.Sockets.TcpClient]::new()
try {
  $task = $client.ConnectAsync("127.0.0.1", $port)
  $inUse = $task.Wait(1000) -and $client.Connected
} catch {
  $inUse = $false
} finally {
  $client.Dispose()
}

if ($inUse) {
  Write-Log "port $port already listening; exiting"
  exit 0
}

# Build fallback when the client bundle is missing.
if (-not (Test-Path (Join-Path $root "client\dist\index.html"))) {
  Write-Log "client/dist/index.html missing; running npm.cmd run build"
  $buildLog = Join-Path $logDir "build.log"
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & npm.cmd run build *> $buildLog
  $buildCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($buildCode -ne 0) {
    Write-Log "build failed"
    exit 1
  }
  Write-Log "build ok"
}

# Resolve node.exe without relying on the task's PATH.
$node = $null
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCommand) {
  $node = $nodeCommand.Source
} elseif (Test-Path "C:\Program Files\nodejs\node.exe") {
  $node = "C:\Program Files\nodejs\node.exe"
}
if (-not $node) {
  Write-Log "node.exe not found"
  exit 1
}

# Keep the log directory small.
$cutoff = (Get-Date).AddDays(-7)
Get-ChildItem -Path $logDir -Filter "server-*.log" -File -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt $cutoff } |
  Remove-Item -Force -ErrorAction SilentlyContinue

# Tablet URL diagnostic only; /tablet is the authoritative source.
$lanIp = $null
try {
  $lanIp = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.|192\.168\.56\.)' } |
    Select-Object -First 1 -ExpandProperty IPAddress
} catch {
  $lanIp = $null
}
if (-not $lanIp) {
  Write-Log "tablet URL: no LAN address"
} else {
  Write-Log "tablet URL: http://${lanIp}:$port"
}

while ($true) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $outLog = Join-Path $logDir "server-$stamp.out.log"
  $errLog = Join-Path $logDir "server-$stamp.err.log"
  Write-Log "starting server"
  # -Wait (not WaitForExit) so ExitCode is populated when output is redirected
  # under PowerShell 5.1.
  $server = Start-Process -FilePath $node -ArgumentList "server/index.mjs" `
    -WindowStyle Hidden -WorkingDirectory $root `
    -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru -Wait
  $code = $server.ExitCode
  Write-Log "server exited code $code; restarting in 5s"
  Start-Sleep -Seconds 5
}
