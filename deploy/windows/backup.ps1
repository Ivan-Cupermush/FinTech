<#
.SYNOPSIS
  Резервная копия offix: база PostgreSQL (pg_dump) и загруженные файлы (uploads).

.DESCRIPTION
  База — полный дамп в формате custom (восстановление: pg_restore). Хранятся
  последние -KeepDays дней. Файлы копируются robocopy в режиме «только добавить»:
  удалённое на сервере в копии остаётся. Копию лучше держать на ДРУГОМ диске,
  а ещё лучше — дополнительно вне сервера.
  Адрес базы и папка файлов берутся из server\.env (DATABASE_URL, UPLOADS_DIR);
  пароль базы передаётся pg_dump через переменную окружения, в командную строку не попадает.

.EXAMPLE
  # разово
  powershell -ExecutionPolicy Bypass -File C:\offix\deploy\windows\backup.ps1 -BackupDir D:\offix-backup
.EXAMPLE
  # каждый день в 03:30 (задача планировщика от имени SYSTEM)
  powershell -ExecutionPolicy Bypass -File C:\offix\deploy\windows\backup.ps1 -BackupDir D:\offix-backup -Register
#>
param(
  [string]$Root = '',
  [Parameter(Mandatory = $true)][string]$BackupDir,
  [int]$KeepDays = 30,
  [switch]$Register
)

$ErrorActionPreference = 'Stop'
# Папка скрипта: $PSScriptRoot бывает пустым (зависит от способа запуска), поэтому есть запасные способы.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Root) { $Root = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path }
. (Join-Path $ScriptDir 'common.ps1')

if ($Register) {
  Assert-Admin
  $self = if ($PSCommandPath) { $PSCommandPath } else { $MyInvocation.MyCommand.Path }
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$self`" -Root `"$Root`" -BackupDir `"$BackupDir`" -KeepDays $KeepDays"
  $trigger = New-ScheduledTaskTrigger -Daily -At '03:30'
  Register-ScheduledTask -TaskName 'offix backup' -Action $action -Trigger $trigger -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
  Ok "Ежедневная копия зарегистрирована (03:30) в $BackupDir"
  return
}

$server = Join-Path $Root 'server'
$envVars = Read-DotEnv (Join-Path $server '.env')
$db = Get-DatabaseParts $envVars['DATABASE_URL']
$pgDump = Get-ChildItem -Path 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
  Sort-Object { [int]($_.Directory.Parent.Name -replace '\D', '') } -Descending | Select-Object -First 1
if (-not $pgDump) { throw 'pg_dump.exe не найден в C:\Program Files\PostgreSQL\*\bin' }

$dbDir = Join-Path $BackupDir 'db'
New-Item -ItemType Directory -Path $dbDir -Force | Out-Null
$file = Join-Path $dbDir ("{0}-{1}.dump" -f $db.Name, (Get-Date -Format 'yyyyMMdd-HHmm'))

Step "Дамп базы $($db.Name) ($($db.Host):$($db.Port))"
$env:PGPASSWORD = $db.Password
try {
  Invoke-Native $pgDump.FullName @('-h', $db.Host, '-p', "$($db.Port)", '-U', $db.User, '-F', 'c', '-f', $file, $db.Name)
} finally {
  Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
Ok "$file ($([math]::Round((Get-Item $file).Length / 1MB, 1)) МБ)"

Get-ChildItem -Path $dbDir -Filter '*.dump' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) } | Remove-Item -Force

Step 'Файлы (uploads)'
$uploads = if ($envVars['UPLOADS_DIR'] -and [IO.Path]::IsPathRooted($envVars['UPLOADS_DIR'])) { $envVars['UPLOADS_DIR'] } elseif ($envVars['UPLOADS_DIR']) { Join-Path $server $envVars['UPLOADS_DIR'] } else { Join-Path $server 'data\uploads' }
if (-not (Test-Path $uploads)) {
  Warn "Папки $uploads нет — файлов ещё не загружали"
} else {
  & robocopy $uploads (Join-Path $BackupDir 'uploads') /E /XO /R:2 /W:5 /NP /NFL /NDL | Out-Null
  # robocopy: коды 0–7 — успех (8 и выше — ошибки копирования).
  if ($LASTEXITCODE -ge 8) { throw "robocopy завершился с ошибкой $LASTEXITCODE" }
  Ok "Файлы скопированы в $(Join-Path $BackupDir 'uploads')"
}
