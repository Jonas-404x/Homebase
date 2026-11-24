@echo off
rem Mainframe startet ab jetzt automatisch und unsichtbar, wenn du dich bei Windows anmeldest.
cd /d "%~dp0..\.."
if not exist node_modules (
  echo Installiere Abhaengigkeiten ...
  call npm install || goto :fehler
)
if not exist apps\web\dist\index.html (
  echo Baue die Oberflaeche ...
  call npm run build -w apps/web || goto :fehler
)
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Mainframe.lnk'); $s.TargetPath='wscript.exe'; $s.Arguments='\"%~dp0hintergrund.vbs\"'; $s.WorkingDirectory='%~dp0'; $s.Save()" || goto :fehler
call "%~dp0stoppen.cmd" >nul
wscript.exe "%~dp0hintergrund.vbs"
echo Fertig. Mainframe laeuft jetzt im Hintergrund und startet kuenftig automatisch.
echo Am PC: http://localhost:8787
pause
goto :eof
:fehler
echo Da ist was schiefgelaufen. Siehe Meldung oben.
pause
