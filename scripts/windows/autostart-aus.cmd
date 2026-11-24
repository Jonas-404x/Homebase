@echo off
rem Mainframe startet nicht mehr automatisch. Ein laufendes Mainframe wird beendet.
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Mainframe.lnk" 2>nul
call "%~dp0stoppen.cmd"
echo Autostart ist aus.
pause
