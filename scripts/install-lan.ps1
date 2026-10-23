#Requires -RunAsAdministrator
# Installs the Solace LAN server as an autostart scheduled task, ensures the
# inbound firewall rule, creates desktop links to the tablet page and the LAN
# URL tool, and applies AC-only power settings.
# Re-running is safe: the previous server tree is stopped before the task,
# shortcuts, firewall rule, and power settings are replaced.
$ErrorActionPreference = "Stop"

$taskName = "Solace Server"
$lanPort = 3000

$root = Split-Path -Parent $PSScriptRoot
$vbs = Join-Path $PSScriptRoot "solace-serve.vbs"
if (-not (Test-Path (Join-Path $root "client\dist\index.html"))) {
  throw "client/dist/index.html is missing; run the safe client build first"
}

# Only touch the running server when this task was already installed. On first
# install the manual server on port 3000 must be left alone.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Write-Host "stopping the existing '$taskName' task and its process tree"
  & (Join-Path $PSScriptRoot "stop-lan.ps1")
  if ($LASTEXITCODE -ne 0) { throw "port 3000 is still in use" }
}

# Inbound firewall rule so the tablet can reach the laptop. Recreate it so the
# settings always match this install; removing and adding is idempotent.
if (Get-NetFirewallRule -DisplayName "Solace LAN" -ErrorAction SilentlyContinue) {
  Remove-NetFirewallRule -DisplayName "Solace LAN"
}
New-NetFirewallRule -DisplayName "Solace LAN" -Direction Inbound -Action Allow `
  -Protocol TCP -LocalPort $lanPort -RemoteAddress LocalSubnet -Profile Any `
  -Enabled True | Out-Null
Write-Host "ensured firewall rule 'Solace LAN' (TCP $lanPort inbound, LocalSubnet, all profiles)"

# Register or replace the task. This does not start the server.
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//B //Nologo `"$vbs`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -Hidden
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Write-Host "registered scheduled task '$taskName'"

# Desktop shortcut to the tablet connection page.
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "Solace tablet link.url"
"[InternetShortcut]`r`nURL=http://localhost:3000/tablet`r`n" | Set-Content -Path $shortcut -Encoding ASCII
Write-Host "created shortcut '$shortcut'"

# Desktop shortcut that prints the current LAN URL, compares it with the last
# server start, copies it, and opens the app in a terminal that stays open.
$urlShortcut = Join-Path $desktop "Solace URL.lnk"
$showUrlScript = Join-Path $PSScriptRoot "show-lan-url.ps1"
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut($urlShortcut)
$link.TargetPath = "powershell.exe"
$link.Arguments = "-NoExit -NoProfile -ExecutionPolicy Bypass -File `"$showUrlScript`""
$link.WorkingDirectory = $root
$link.Description = "Show the current Solace LAN URL"
$link.Save()
[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($link)
[void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
Write-Host "created shortcut '$urlShortcut'"

# AC-only power settings. Failures are warnings, never install failures.
powercfg /change standby-timeout-ac 0
if ($LASTEXITCODE -ne 0) {
  Write-Warning "could not set the AC standby timeout; continuing"
}
powercfg /change hibernate-timeout-ac 0
if ($LASTEXITCODE -ne 0) {
  Write-Warning "could not set the AC hibernate timeout; continuing"
}
powercfg /setacvalueindex SCHEME_CURRENT 19cbb8fa-5279-450e-9fac-8a3d5fedd0c1 12bbebe6-58d6-4636-95bb-3217ef867c1a 0
if ($LASTEXITCODE -ne 0) {
  Write-Warning "could not set the wireless adapter AC power mode; continuing"
}
powercfg /setactive SCHEME_CURRENT
if ($LASTEXITCODE -ne 0) {
  Write-Warning "could not reactivate the current power scheme; continuing"
}

$logDir = Join-Path $env:LOCALAPPDATA "Solace\logs"
Write-Host ""
Write-Host "Solace LAN autostart installed."
Write-Host "  Task:     $taskName (AtLogOn, interactive, hidden)"
Write-Host "  Shortcut: $shortcut"
Write-Host "  URL link: $urlShortcut"
Write-Host "  Firewall: Solace LAN (TCP $lanPort inbound, LocalSubnet, all profiles)"
Write-Host "  URL:      http://localhost:$lanPort/tablet"
Write-Host "  Logs:     $logDir"
Write-Host "The server starts at your next logon; this installer did not start it."
