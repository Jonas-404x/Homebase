' Startet Mainframe unsichtbar im Hintergrund (ohne Fenster).
' Startet vorher Docker Desktop leise (scripts\windows\docker-starten.ps1).
' Ausgaben landen in .data\mainframe.log im Mainframe-Ordner.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = fso.GetParentFolderName(fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName)))
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts\windows\docker-starten.ps1", 0, False
sh.Run "cmd /c (if not exist .data mkdir .data) & node --env-file=dev.env apps/server/src/index.ts >> .data\mainframe.log 2>&1", 0, False
