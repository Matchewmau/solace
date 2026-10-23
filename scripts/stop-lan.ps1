#Requires -RunAsAdministrator
# Stops the Solace LAN server: scheduled task, wscript/powershell tree, and
# the Solace node process. Verifies that port 3000 is free.
$ErrorActionPreference = "Continue"

$taskName = "Solace Server"

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Write-Host "stopped scheduled task '$taskName'"
} else {
  Write-Host "scheduled task '$taskName' not found"
}

$wscriptProcs = Get-CimInstance Win32_Process -Filter "Name = 'wscript.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'solace-serve\.vbs' }
foreach ($proc in $wscriptProcs) {
  Write-Host "killing wscript.exe tree $($proc.ProcessId)"
  & taskkill.exe /PID $proc.ProcessId /T /F | Out-Null
}

# The wscript.exe parent may already be gone; catch the supervisor directly.
$powershellProcs = Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'serve-lan\.ps1' }
foreach ($proc in $powershellProcs) {
  Write-Host "killing powershell.exe tree $($proc.ProcessId)"
  & taskkill.exe /PID $proc.ProcessId /T /F | Out-Null
}

$nodeProcs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'server[\\/]index\.mjs' }
foreach ($proc in $nodeProcs) {
  Write-Host "stopping node.exe $($proc.ProcessId)"
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
}

Start-Sleep -Seconds 2

$inUse = $false
$client = [System.Net.Sockets.TcpClient]::new()
try {
  $task = $client.ConnectAsync("127.0.0.1", 3000)
  $inUse = $task.Wait(1000) -and $client.Connected
} catch {
  $inUse = $false
} finally {
  $client.Dispose()
}

if ($inUse) {
  Write-Host "port 3000 is still in use"
  exit 1
}
Write-Host "port 3000 is free"
exit 0
