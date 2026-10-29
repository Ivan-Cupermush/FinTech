# Общие функции скриптов развёртывания offix на Windows (PowerShell 5.1+).
# Файл подключается из других скриптов: . (Join-Path $ScriptDir 'common.ps1')
# Кодировка всех .ps1 — UTF-8 с BOM: без BOM Windows PowerShell 5.1 читает кириллицу как ANSI.

function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "OK  $Text" -ForegroundColor Green }
function Warn([string]$Text) { Write-Host "!!  $Text" -ForegroundColor Yellow }
function Bad([string]$Text) { Write-Host "XX  $Text" -ForegroundColor Red }

function Assert-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Запустите PowerShell от имени администратора.'
  }
}

# Запуск внешней программы с проверкой кода выхода
# (в PowerShell 5.1 ошибка внешней команды сама по себе скрипт не останавливает).
function Invoke-Native {
  param([string]$File, [string[]]$Arguments, [string]$WorkDir = (Get-Location).Path)
  Push-Location $WorkDir
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Команда завершилась с ошибкой (код $LASTEXITCODE): $File $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

# Чтение server\.env в словарь так же, как его читает сервер (process.loadEnvFile):
# всё после # без кавычек — комментарий, кавычки вокруг значения снимаются.
function Read-DotEnv([string]$Path) {
  $vars = @{}
  if (-not (Test-Path $Path)) { return $vars }
  foreach ($line in Get-Content -Path $Path -Encoding UTF8) {
    $t = $line.Trim()
    if ($t -eq '' -or $t.StartsWith('#')) { continue }
    if ($t.StartsWith('export ')) { $t = $t.Substring(7).Trim() }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $key = $t.Substring(0, $i).Trim()
    $value = $t.Substring($i + 1).Trim()
    $quoted = $value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))
    if ($quoted) {
      $value = $value.Substring(1, $value.Length - 2)
    } else {
      $hash = $value.IndexOf('#')
      if ($hash -ge 0) { $value = $value.Substring(0, $hash).Trim() }
    }
    $vars[$key] = $value
  }
  return $vars
}

function Get-ServerPort([string]$ServerDir) {
  $envVars = Read-DotEnv (Join-Path $ServerDir '.env')
  if ($envVars.ContainsKey('PORT') -and $envVars['PORT']) { return [int]$envVars['PORT'] }
  return 4000
}

# Части DATABASE_URL (postgres://user:password@host:port/name) — для pg_dump и диагностики.
function Get-DatabaseParts([string]$Url) {
  if (-not $Url) { $Url = 'postgres://offix:offix@localhost:5432/offix' }
  $u = [Uri]$Url
  $user = ''; $password = ''
  if ($u.UserInfo) {
    $pair = $u.UserInfo.Split(':', 2)
    $user = [Uri]::UnescapeDataString($pair[0])
    if ($pair.Count -gt 1) { $password = [Uri]::UnescapeDataString($pair[1]) }
  }
  $port = if ($u.Port -gt 0) { $u.Port } else { 5432 }
  return @{ Host = $u.Host; Port = $port; User = $user; Password = $password; Name = $u.AbsolutePath.TrimStart('/') }
}

# Адрес базы без пароля — для вывода на экран и в журналы.
function Hide-Password([string]$Url) {
  if (-not $Url) { return '' }
  return ($Url -replace '(://[^:/@]+:)[^@]*@', '$1***@')
}

function Wait-ServiceStatus([string]$Name, [string]$Status, [int]$Seconds) {
  $svc = Get-Service -Name $Name -ErrorAction SilentlyContinue
  if (-not $svc) { return }
  try {
    $svc.WaitForStatus($Status, [TimeSpan]::FromSeconds($Seconds))
  } catch {
    throw "Служба $Name не перешла в состояние $Status за $Seconds с"
  }
}

function Wait-Health([int]$Port, [int]$Seconds) {
  $url = "http://127.0.0.1:$Port/api/health"
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $r = Invoke-RestMethod -Uri $url -TimeoutSec 5 -UseBasicParsing
      if ($r.ok -eq $true) { Ok "Сервер отвечает: $url"; return }
    } catch { }
    Start-Sleep -Seconds 2
  }
  throw "Сервер не ответил на $url за $Seconds с. Смотрите журнал logs\server.log"
}

# Что сообщает запущенный сервер о себе: версия кода, последняя миграция, сайт, ffmpeg.
function Show-HealthInfo([int]$Port) {
  try {
    $h = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 5 -UseBasicParsing
  } catch { Bad "/api/health не отвечает: $($_.Exception.Message)"; return }
  if ($h.version) { Ok "Запущен код версии $($h.version), миграция базы: $($h.migration)" } else { Warn 'Сервер не сообщает версию — запущена старая сборка. Запустите update.ps1' }
  if ($h.site -eq $true) { Ok 'Сайт отдаёт сам сервер (web\dist)' } elseif ($h.site -eq $false) { Warn 'Сервер отдаёт только API: проверьте NODE_ENV=production и WEB_DIST_DIR в server\.env' }
  if ($null -ne $h.media) {
    if ($h.media.ffmpeg) { Ok 'ffmpeg найден: обложки видео и голосовые с сайта работают' } else { Warn 'ffmpeg не найден: у видео нет обложек, голосовые с сайта не перекодируются. См. docs\DEPLOY.md, раздел «Программы»' }
  }
}

# npm ci только если package-lock.json изменился с прошлой установки (экономит минуты при обновлении).
# В offix один package-lock.json на ядро, сервер и сайт — в корне репозитория.
function Test-DependenciesChanged([string]$Dir) {
  $lock = Join-Path $Dir 'package-lock.json'
  $stamp = Join-Path $Dir 'node_modules\.offix-lock-hash'
  if (-not (Test-Path $stamp)) { return $true }
  $hash = (Get-FileHash -Path $lock -Algorithm SHA256).Hash
  return ((Get-Content -Path $stamp -Raw).Trim() -ne $hash)
}

function Install-Dependencies([string]$Dir) {
  # --include=dev: сборке нужны TypeScript, Vite и esbuild, даже если в окружении NODE_ENV=production.
  Invoke-Native 'npm.cmd' @('ci', '--include=dev', '--no-audit', '--no-fund') $Dir
  $hash = (Get-FileHash -Path (Join-Path $Dir 'package-lock.json') -Algorithm SHA256).Hash
  Set-Content -Path (Join-Path $Dir 'node_modules\.offix-lock-hash') -Value $hash -Encoding ASCII
}

# Заменяет папку $Target на $Next, предыдущую версию оставляет в $Target-prev (для отката).
function Switch-Folder([string]$Target, [string]$Next) {
  $prev = "$Target-prev"
  if (Test-Path $prev) { Remove-Item -Path $prev -Recurse -Force }
  if (Test-Path $Target) { Rename-Item -Path $Target -NewName (Split-Path $prev -Leaf) }
  Rename-Item -Path $Next -NewName (Split-Path $Target -Leaf)
}

# Останавливает службу вместе с зависимыми (OffixTunnel зависит от Offix).
# Возвращает имена зависимых служб, которые работали, — их потом запускает Start-OffixService.
function Stop-OffixService([string]$Name) {
  $running = @((Get-Service -Name $Name).DependentServices | Where-Object { $_.Status -eq 'Running' } | ForEach-Object { $_.Name })
  Stop-Service -Name $Name -Force
  Wait-ServiceStatus $Name 'Stopped' 60 | Out-Null
  return ,$running
}

function Start-OffixService([string]$Name, [string[]]$Dependents = @()) {
  Start-Service -Name $Name
  foreach ($d in $Dependents) {
    if ($d) { Start-Service -Name $d -ErrorAction SilentlyContinue }
  }
}
