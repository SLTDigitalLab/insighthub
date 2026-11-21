param([Parameter(Mandatory = $true)][string]$Src, [Parameter(Mandatory = $true)][string]$Dst)

# Rebuilds the table of contents of a generated proposal with Microsoft Word (page numbers of THIS document, entries in the template's
# own "TOC 1" style) and saves the result as a .docx. Used by services/pdfService.js (refreshContents); when Word is not there the
# caller keeps the document as it is.
$Src = (Resolve-Path $Src).Path
$Dst = [System.IO.Path]::GetFullPath($Dst)
$word = $null
$doc = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open($Src, $false, $false)
  # twice: the first update can move the headings by a line, so the numbers are set again on the settled layout
  foreach ($pass in 1..2) {
    foreach ($toc in $doc.TablesOfContents) { $toc.Update() }
  }
  try {
  # a heading with no text (a picture on a Heading 1 line) still comes back from Word's rebuild as an entry with only a page number:
  # those entries are taken out of the contents, so it never shows a blank line "........ 14"
  foreach ($toc in $doc.TablesOfContents) {
    $paras = $toc.Range.Paragraphs
    for ($i = $paras.Count; $i -ge 1; $i--) {
      $text = [string]$paras.Item($i).Range.Text
      if (($text -match '[0-9]') -and (($text -replace '[^\p{L}]', '') -eq '')) { try { $paras.Item($i).Range.Delete() | Out-Null } catch {} }
    }
  }
  } catch {}
  $doc.SaveAs2([ref]$Dst, [ref]16)
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
