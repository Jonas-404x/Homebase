# Startet Docker Desktop leise im Hintergrund (ohne Fenster).
# Vorher werden Socket-Reste vom letzten Windows-Start beiseitegeschoben: Windows macht sie nach
# einem Neustart oft unzugänglich ("Das System kann auf die Datei nicht zugreifen"), und dann stürzt
# Docker Desktop beim Start ab.
$ErrorActionPreference = 'SilentlyContinue'
$exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
$userExe = Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'
if (Test-Path $userExe) { $exe = $userExe }
if (-not (Test-Path $exe)) { exit 0 }
if (Get-Process -Name 'Docker Desktop') { exit 0 }

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
foreach ($dir in @((Join-Path $env:LOCALAPPDATA 'Docker\run'), (Join-Path $env:LOCALAPPDATA 'docker-secrets-engine'))) {
  if (Test-Path $dir) { Rename-Item $dir "$(Split-Path $dir -Leaf)-alt-$stamp" }
}
# Alte, beiseitegeschobene Ordner aufräumen, soweit Windows das inzwischen zulässt.
Get-ChildItem $env:LOCALAPPDATA, (Join-Path $env:LOCALAPPDATA 'Docker') -Directory -Filter '*-alt-*' |
  Where-Object { $_.Name -like 'run-alt-*' -or $_.Name -like 'docker-secrets-engine-alt-*' } |
  ForEach-Object { Remove-Item $_.FullName -Recurse -Force }

Start-Process -FilePath $exe -WindowStyle Minimized
