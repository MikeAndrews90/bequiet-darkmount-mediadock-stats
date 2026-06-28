Dim shell, fso, scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "cmd /c cd /d """ & scriptDir & """ && node automate.js >> automate.log 2>&1", 0, False
