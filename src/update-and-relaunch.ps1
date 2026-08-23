param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Application,
  [Parameter(Mandatory = $true)][int]$ParentProcessId,
  [Parameter(Mandatory = $true)][string]$StatusFile
)

$ErrorActionPreference = 'Stop'
$statusDirectory = Split-Path -Parent $StatusFile

function Save-UpdateStatus([string]$state, [string]$detail = '') {
  New-Item -ItemType Directory -Path $statusDirectory -Force | Out-Null
  $json = @{ state = $state; detail = $detail; updatedAt = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($StatusFile, $json, $utf8WithoutBom)
}

Save-UpdateStatus 'ready'

try {
  $parent = Get-Process -Id $ParentProcessId -ErrorAction Stop
  $parent.WaitForExit()
} catch {
  # The parent may already have exited before this helper begins.
}

try {
  $installationDirectory = Split-Path -Parent $Application
  $applicationName = Split-Path -Leaf $Application
  Save-UpdateStatus 'installing'
  $installerArguments = "/S `"/D=$installationDirectory`""
  $installation = Start-Process -FilePath $Installer -ArgumentList $installerArguments -Wait -PassThru
  if ($installation.ExitCode -ne 0) { throw "INSTALLER_EXIT_$($installation.ExitCode)" }
  $installedApplication = Join-Path $installationDirectory $applicationName
  if (-not (Test-Path $installedApplication)) { throw 'INSTALLED_APPLICATION_MISSING' }
  Save-UpdateStatus 'relaunching'
  Start-Process -FilePath $installedApplication -WorkingDirectory $installationDirectory
  Save-UpdateStatus 'completed'
} catch {
  Save-UpdateStatus 'failed' $_.Exception.Message
  if (Test-Path $Application) { Start-Process -FilePath $Application -WorkingDirectory (Split-Path -Parent $Application) }
}
