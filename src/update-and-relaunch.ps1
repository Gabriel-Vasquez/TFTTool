param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Application,
  [Parameter(Mandatory = $true)][int]$ParentProcessId
)

$ErrorActionPreference = 'Stop'

try {
  $parent = Get-Process -Id $ParentProcessId -ErrorAction Stop
  $parent.WaitForExit()
} catch {
  # The parent may already have exited before this helper begins.
}

$installation = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
if ($installation.ExitCode -eq 0) {
  Start-Process -FilePath $Application -WorkingDirectory (Split-Path -Parent $Application)
}
