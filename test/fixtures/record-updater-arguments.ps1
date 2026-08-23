param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Application,
  [Parameter(Mandatory = $true)][int]$ParentProcessId,
  [Parameter(Mandatory = $true)][string]$StatusFile
)

@{
  installer = $Installer
  application = $Application
  parentProcessId = $ParentProcessId
  statusFile = $StatusFile
} | ConvertTo-Json -Compress | Set-Content -LiteralPath $StatusFile -Encoding UTF8
