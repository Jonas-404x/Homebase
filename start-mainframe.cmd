@echo off
rem Startet Mainframe auf diesem PC (Entwicklungsmodus) und oeffnet es im Browser.
rem Docker Desktop sollte laufen, damit Apps wie AdGuard funktionieren.
cd /d "%~dp0"
if not exist node_modules (
  echo Installiere Abhaengigkeiten, das dauert beim ersten Mal kurz ...
  call npm install || goto :fehler
)
if not exist apps\web\dist\index.html (
  echo Baue die Oberflaeche ...
  call npm run build -w apps/web || goto :fehler
)
echo Mainframe laeuft auf http://localhost:8787  (Fenster offen lassen, schliessen beendet Mainframe)
start "" http://localhost:8787
node --env-file=dev.env apps/server/src/index.ts
goto :eof
:fehler
echo Da ist was schiefgelaufen. Siehe Meldung oben.
pause
