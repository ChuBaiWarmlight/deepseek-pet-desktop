# Show the initial admin credentials (generated on first server start).
$dir = "$HOME\.dsh-pet-assets"
$f = Join-Path $dir "initial-admin.txt"
if (Test-Path $f) {
  Write-Output "Initial admin credentials:"
  Get-Content $f
} else {
  Write-Output "initial-admin.txt not found (admin already created, or server never started)."
  Write-Output "To reset the admin, delete $dir\dsh-pet-assets.db and restart the server."
}
