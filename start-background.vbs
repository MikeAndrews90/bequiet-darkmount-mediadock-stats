Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c cd /d E:\Dev\keyboard-stats && node automate.js >> automate.log 2>&1", 0, False
