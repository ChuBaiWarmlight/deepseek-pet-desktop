# Copy 51 webm assets from the source directory into the data directory.
param(
  [string]$Source = "E:\esign_5.3\dsh-pet-standalone\assets\videos",
  [string]$Dest = "$HOME\.dsh-pet-assets\assets\videos"
)
if (-not (Test-Path $Source)) {
  Write-Error "Source directory not found: $Source"
  exit 1
}
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
$files = Get-ChildItem $Source -Filter *.webm -File
foreach ($f in $files) {
  Copy-Item $f.FullName -Destination (Join-Path $Dest $f.Name) -Force
}
Write-Output "Copied $($files.Count) webm files to $Dest"
Write-Output "Start the server (it auto-indexes on boot), or call POST /api/rebuild."
