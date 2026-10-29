param([Parameter(Mandatory = $true)][string]$Src, [Parameter(Mandatory = $true)][string]$Dst)

$Src = (Resolve-Path $Src).Path
$Dst = [System.IO.Path]::GetFullPath($Dst)
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($Src, $false, $true)
  # 17 = wdExportFormatPDF (pixel-perfect native Word PDF export)
  $doc.ExportAsFixedFormat($Dst, 17)
  $doc.Close([ref]$false)
} finally {
  if ($doc -ne $null) {
    try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc) | Out-Null } catch {}
  }
  if ($word -ne $null) {
    try { $word.Quit([ref]$false) } catch {}
    try { [System.Runtime.InteropServices.Marshal]::FinalReleaseComObject($word) | Out-Null } catch {}
  }
  [GC]::Collect()
  [GC]::WaitForPendingFinalizers()
}
Write-Output "saved $Dst"
