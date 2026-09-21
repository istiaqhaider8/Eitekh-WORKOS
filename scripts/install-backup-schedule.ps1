<#
.SYNOPSIS
  Register (or remove) the nightly database backup as a Windows scheduled task.

.DESCRIPTION
  The backup scripts have existed for weeks and had never run, which is how a
  routine temp-directory cleanup became total loss of the development
  database. A backup script nobody schedules is a plan, not a backup.

  The task runs scripts/backup-scheduled.mjs, which resolves .env, the backup
  directory and the pg_dump path itself. That indirection is deliberate: the
  scheduled task holds one command and never needs editing again.

  WHY IT RUNS AS THE LOGGED-ON USER
  Running "whether the user is logged on or not" means storing the account
  password in the task, and a prompt for it cannot be answered by an automated
  session. Interactive logon avoids that. The cost is that a backup is missed
  while nobody is signed in -- which -StartWhenAvailable then makes up for at
  the next opportunity, and is why a laptop still gets backed up.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/install-backup-schedule.ps1
  powershell -ExecutionPolicy Bypass -File scripts/install-backup-schedule.ps1 -At 03:30
  powershell -ExecutionPolicy Bypass -File scripts/install-backup-schedule.ps1 -Uninstall
#>

param(
  [string]$TaskName = "EitekhWorkOS-DbBackup",
  [string]$At = "02:00",
  [switch]$Uninstall,
  [switch]$RunNow
)

$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $repo "scripts\backup-scheduled.mjs"

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[schedule] removed $TaskName"
  } else {
    Write-Host "[schedule] $TaskName was not registered"
  }
  exit 0
}

if (-not (Test-Path $entry)) { throw "Cannot find $entry" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node is not on PATH; the scheduled task needs its full path" }

# ASCII only in this file: see the note at the top about codepages.
# Quoted by concatenation rather than with backtick escapes: the repository
# path contains spaces, and `"...`" inside an expandable string is the kind of
# quoting that parses differently in Windows PowerShell 5.1 than it reads.
$quotedEntry = '"' + $entry + '"'

$action = New-ScheduledTaskAction -Execute $node -Argument $quotedEntry -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -Daily -At $At

# StartWhenAvailable is the one that matters on a laptop: it runs a missed
# backup once the machine is on again, instead of skipping the night.
# The battery settings are the difference between a backup that happens and
# one that is postponed indefinitely by power management.
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
  -MultipleInstances IgnoreNew

$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description "Nightly PostgreSQL backup for Eitekh WorkOS (scripts/backup-scheduled.mjs)." `
  -Force | Out-Null

Write-Host "[schedule] registered '$TaskName' -- daily at $At, catching up a missed run when the machine returns."
Write-Host "[schedule] command: $node `"$entry`""
Write-Host "[schedule] log:     $env:USERPROFILE\.eitekh\backups\backup.log"

if ($RunNow) {
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[schedule] started one run now."
}
