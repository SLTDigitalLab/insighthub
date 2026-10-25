param([Parameter(Mandatory = $true)][string]$Src, [Parameter(Mandatory = $true)][string]$Dst)

$Src = (Resolve-Path $Src).Path
$Dst = [System.IO.Path]::GetFullPath($Dst)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Src, $false, $true)
  # 17 = wdExportFormatPDF (pixel-perfect native Word PDF export)
  $doc.ExportAsFixedFormat($Dst, 17)
  $doc.Close($false)
} finally {
  $word.Quit()
}
Write-Output "saved $Dst"
