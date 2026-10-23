Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = repoRoot
code = sh.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptDir & "\serve-lan.ps1""", 0, True)
WScript.Quit code
