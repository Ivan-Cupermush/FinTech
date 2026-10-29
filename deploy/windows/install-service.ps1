<#
.SYNOPSIS
  Регистрирует offix как службу Windows (через NSSM): автозапуск при загрузке,
  перезапуск при падении, журнал в logs\server.log с ротацией.

.DESCRIPTION
  Сервер работает как служба, а не окнами с «npm run dev»: один процесс,
  один порт (по умолчанию 4000) — и API, и сайт, и сообщения в реальном времени.

  Перед запуском:
    1. Установлены Node.js 22 LTS, Git, PostgreSQL 16+, NSSM (winget install NSSM.NSSM).
    2. Заполнен server\.env (образец — server\.env.example, раздел 3 в docs\DEPLOY.md).
  После: update.ps1 -SkipPull — соберёт сайт и сервер и запустит службу.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File C:\offix\deploy\windows\install-service.ps1 -StopOldProcesses
#>
param(
  [string]$Root = '',
  [string]$Service = 'Offix',
  [string]$Nssm = 'nssm.exe',
  # Завершить старые ручные запуски (Vite на 5173, node на порту сервера).
  [switch]$StopOldProcesses
)

$ErrorActionPreference = 'Stop'
# Папка скрипта: $PSScriptRoot бывает пустым (зависит от способа запуска), поэтому есть запасные способы.
$ScriptDir = if ($PSScriptRoot) { $PSScriptRoot } elseif ($PSCommandPath) { Split-Path -Parent $PSCommandPath } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
if (-not $Root) { $Root = (Resolve-Path (Join-Path $ScriptDir '..\..')).Path }
. (Join-Path $ScriptDir 'common.ps1')
Assert-Admin

$server = Join-Path $Root 'server'
$logs = Join-Path $Root 'logs'

Step 'Проверяю окружение'
$node = (Get-Command node.exe -ErrorAction SilentlyContinue)
if (-not $node) { throw 'Node.js не найден. Установите Node.js 22 LTS.' }
$nodeMajor = [int]((& node.exe -v).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw "Нужен Node.js 22+, установлен $(& node.exe -v)" }
Ok "Node.js $(& node.exe -v): $($node.Source)"

# NSSM, положенный вручную в C:\nssm (на Windows Server без winget), находим сам.
if (-not (Get-Command $Nssm -ErrorAction SilentlyContinue) -and (Test-Path 'C:\nssm\nssm.exe')) { $Nssm = 'C:\nssm\nssm.exe' }
if (-not (Get-Command $Nssm -ErrorAction SilentlyContinue)) {
  throw 'NSSM не найден. Установите: winget install NSSM.NSSM, либо положите nssm.exe в C:\nssm (или укажите путь: -Nssm C:\tools\nssm.exe)'
}

$envFile = Join-Path $server '.env'
if (-not (Test-Path $envFile)) { throw "Нет $envFile. Скопируйте server\.env.example в server\.env и заполните." }
$envVars = Read-DotEnv $envFile
$rawSecret = (Get-Content $envFile -Encoding UTF8 | Where-Object { $_ -match '^\s*JWT_SECRET\s*=' } | Select-Object -First 1)
if ($rawSecret -and $rawSecret.Contains('#') -and -not ($rawSecret -match '=\s*["'']')) {
  throw 'В JWT_SECRET есть символ # — всё после него считается комментарием и ключ обрезается. Сгенерируйте ключ из букв и цифр (см. docs\DEPLOY.md).'
}
if (-not $envVars['JWT_SECRET'] -or $envVars['JWT_SECRET'].Length -lt 32) { throw 'JWT_SECRET в .env пустой или короче 32 символов.' }
if ($envVars['JWT_SECRET'] -like 'change-me*') { throw 'JWT_SECRET в .env — значение из образца. Сгенерируйте свой ключ (см. docs\DEPLOY.md).' }
if ($envVars['NODE_ENV'] -ne 'production') { Warn 'NODE_ENV в .env не production: сервер не будет отдавать сайт. Для боевого сервера поставьте NODE_ENV=production' }
if (-not $envVars['DATABASE_URL']) { throw 'DATABASE_URL в .env не задан.' }
$db = Get-DatabaseParts $envVars['DATABASE_URL']
if ($db.Password -eq 'offix' -or -not $db.Password) { Warn "Пароль базы в DATABASE_URL пустой или из образца ($(Hide-Password $envVars['DATABASE_URL'])) — задайте свой" }
if ($envVars['HOST'] -ne '127.0.0.1') { Warn 'HOST в .env не 127.0.0.1: сервер слушает все адреса. За туннелем или прокси на этом же компьютере поставьте HOST=127.0.0.1' }
$port = Get-ServerPort $server
Ok ".env в порядке (порт $port, база $($db.Name) на $($db.Host):$($db.Port))"

Step 'Ищу старые ручные запуски'
foreach ($p in @(5173, $port)) {
  $listeners = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  foreach ($l in $listeners) {
    $proc = Get-Process -Id $l.OwningProcess -ErrorAction SilentlyContinue
    $name = if ($proc) { $proc.ProcessName } else { '?' }
    if ($StopOldProcesses) {
      Stop-Process -Id $l.OwningProcess -Force
      Ok "Остановлен $name (PID $($l.OwningProcess)) на порту $p"
    } else {
      Warn "Порт $p занят: $name (PID $($l.OwningProcess)). Закройте окно с npm run dev или запустите скрипт с -StopOldProcesses"
    }
  }
}

Step "Регистрирую службу $Service"
New-Item -ItemType Directory -Path $logs -Force | Out-Null
if (Get-Service -Name $Service -ErrorAction SilentlyContinue) {
  Warn "Служба $Service уже есть — обновляю параметры"
  & $Nssm stop $Service | Out-Null
} else {
  Invoke-Native $Nssm @('install', $Service, $node.Source, 'dist\index.js')
}
$settings = @(
  @('Application', $node.Source),
  @('AppParameters', 'dist\index.js'),
  # Сервер читает server\.env из своей рабочей папки.
  @('AppDirectory', $server),
  @('DisplayName', 'offix — сервер и сайт'),
  @('Description', 'offix: API, веб-версия и сообщения в реальном времени (порт ' + $port + ')'),
  @('Start', 'SERVICE_AUTO_START'),
  @('AppStdout', (Join-Path $logs 'server.log')),
  @('AppStderr', (Join-Path $logs 'server.log')),
  @('AppRotateFiles', '1'),
  @('AppRotateOnline', '1'),
  @('AppRotateBytes', '20971520'),
  @('AppExit', 'Default', 'Restart'),
  @('AppRestartDelay', '5000'),
  # Ctrl+C и 15 секунд на корректную остановку (сервер дописывает запросы и закрывает базу).
  @('AppStopMethodConsole', '15000')
)
foreach ($s in $settings) {
  Invoke-Native $Nssm (@('set', $Service) + $s)
}
# Служба запускается после PostgreSQL, если он установлен службой на этом же компьютере.
$pgService = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pgService -and ($db.Host -eq 'localhost' -or $db.Host -eq '127.0.0.1')) {
  Invoke-Native $Nssm @('set', $Service, 'DependOnService', $pgService.Name)
  Ok "Запуск после службы $($pgService.Name)"
}
Ok "Служба $Service зарегистрирована (автозапуск, журнал: $logs\server.log)"
Write-Host ''
Write-Host 'Дальше: соберите и запустите —' -ForegroundColor Cyan
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$ScriptDir\update.ps1`" -SkipPull"
