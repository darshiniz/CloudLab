# BRD BR-13: the three VMs start at 08:50 IST and stop at 17:00 IST on weekdays.
# Run in Windows PowerShell on YOUR computer (az login first). Safe to run again.
#
#   .\infra\azure\vm-schedule.ps1                 # install both halves
#   .\infra\azure\vm-schedule.ps1 -Off            # remove the 08:50 start (holidays, end of project)
#
# Part 1 (17:00 stop)  uses Azure's built-in "auto-shutdown" setting on each VM.
# Part 2 (08:50 start) needs a tiny Azure Automation account: it holds a schedule and a 3-line runbook that starts the VMs.
#                      The Automation account's own identity gets the "Virtual Machine Contributor" role on the resource group.
param(
  [string]$RG = "cloudlab-rg",
  [string[]]$VMs = @("cloudlab-control", "cloudlab-worker-1", "cloudlab-worker-2"),
  [string]$Account = "cloudlab-automation",
  [string]$StartTime = "08:50",      # IST
  [string]$StopTimeUtc = "1130",     # 17:00 IST = 11:30 UTC (az vm auto-shutdown takes UTC as HHMM)
  [switch]$Off
)
$ErrorActionPreference = "Stop"
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "FAILED: $what" } }

$sub = (az account show --query id -o tsv); Check "az account show (run az login first)"
$loc = (az group show -n $RG --query location -o tsv); Check "resource group $RG"
$base = "https://management.azure.com/subscriptions/$sub/resourceGroups/$RG/providers/Microsoft.Automation/automationAccounts/$Account"
$api = "api-version=2023-11-01"
$tmp = Join-Path $env:TEMP "cloudlab-schedule"; New-Item -ItemType Directory -Force $tmp | Out-Null
function Put($url, $obj) {
  $f = Join-Path $tmp ([guid]::NewGuid().ToString() + ".json")
  ($obj | ConvertTo-Json -Depth 10 -Compress) | Set-Content -Encoding utf8 $f
  az rest --method put --url $url --headers "Content-Type=application/json" --body "@$f" -o none; Check "PUT $url"
}

if ($Off) {
  Write-Host "Removing the 08:50 start schedule..."
  az rest --method delete --url "$base/schedules/weekday-start?$api" -o none 2>$null
  Write-Host "Done. (The 17:00 auto-shutdown stays; remove it with: az vm auto-shutdown -g $RG -n <vm> --off)"
  return
}

# ---- Part 1: 17:00 IST shutdown ---------------------------------------------------------------------
foreach ($vm in $VMs) {
  Write-Host "Auto-shutdown 17:00 IST for $vm ..."
  az vm auto-shutdown -g $RG -n $vm --time $StopTimeUtc -o none; Check "auto-shutdown $vm"
}

# ---- Part 2: 08:50 IST start (Automation) -----------------------------------------------------------
Write-Host "Creating the Automation account $Account (system-assigned identity) ..."
Put "$base`?$api" @{ location = $loc; identity = @{ type = "SystemAssigned" }; properties = @{ sku = @{ name = "Basic" } } }
$principal = (az rest --method get --url "$base`?$api" --query identity.principalId -o tsv); Check "read identity"

Write-Host "Giving it permission to start VMs in $RG ..."
$scope = "/subscriptions/$sub/resourceGroups/$RG"
az role assignment create --assignee-object-id $principal --assignee-principal-type ServicePrincipal --role "Virtual Machine Contributor" --scope $scope -o none 2>$null
# (an "already exists" error here is fine)

Write-Host "Creating the runbook ..."
Put "$base/runbooks/Start-CloudLabVMs?$api" @{ location = $loc; properties = @{ runbookType = "PowerShell"; description = "Starts all CloudLab VMs"; draft = @{}; logProgress = $false; logVerbose = $false } }
$code = @"
Connect-AzAccount -Identity | Out-Null
Get-AzVM -ResourceGroupName '$RG' | ForEach-Object { Start-AzVM -ResourceGroupName '$RG' -Name `$_.Name -NoWait | Out-Null; Write-Output ('start requested: ' + `$_.Name) }
"@
$cf = Join-Path $tmp "runbook.ps1"; Set-Content -Encoding utf8 $cf $code
az rest --method put --url "$base/runbooks/Start-CloudLabVMs/draft/content?$api" --headers "Content-Type=text/powershell" --body "@$cf" -o none; Check "upload runbook"
az rest --method post --url "$base/runbooks/Start-CloudLabVMs/publish?$api" -o none; Check "publish runbook"

Write-Host "Creating the weekday $StartTime IST schedule ..."
$tomorrow = (Get-Date).AddDays(1).ToString("yyyy-MM-dd")
Put "$base/schedules/weekday-start?$api" @{ properties = @{
  startTime = "${tomorrow}T${StartTime}:00+05:30"; frequency = "Week"; interval = 1; timeZone = "Asia/Kolkata"
  advancedSchedule = @{ weekDays = @("Monday", "Tuesday", "Wednesday", "Thursday", "Friday") } } }
Put "$base/jobSchedules/$([guid]::NewGuid().ToString())?$api" @{ properties = @{ schedule = @{ name = "weekday-start" }; runbook = @{ name = "Start-CloudLabVMs" } } }

Write-Host ""
Write-Host "Done. VMs stop at 17:00 IST every day and start at $StartTime IST Monday to Friday."
Write-Host "Check: Azure portal > Automation Accounts > $Account > Schedules (and Jobs the morning after)."
Write-Host "Role assignments can take a few minutes to apply, so the first run may be the following morning."
