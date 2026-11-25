@echo off
rem Beendet ein laufendes Mainframe (das Programm auf Port 8787).
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Mainframe ist beendet.
