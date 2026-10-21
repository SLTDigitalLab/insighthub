# One-time conversion of the SLT proposal .doc to .docx with Microsoft Word (run before make_template.py).
#
# usage: powershell -File scripts/convert_doc_word.ps1 "<proposal.doc>" "<out.docx>"
#
# Word keeps this document's layout better than LibreOffice. The .doc is opened read-only and upgraded from
# Word 2003 compatibility mode, so its pictures are saved as modern DrawingML (which LibreOffice also reads well).
param([Parameter(Mandatory = $true)][string]$Src, [Parameter(Mandatory = $true)][string]$Dst)

$Src = (Resolve-Path $Src).Path
$Dst = [System.IO.Path]::GetFullPath($Dst)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  $doc = $word.Documents.Open($Src, $false, $true)
  # ConfirmConversions = false, ReadOnly = true: the source .doc is never changed
  $doc.Convert()
  # Leaves compatibility mode (Word 2003 -> current), turning VML pictures into DrawingML
  $doc.SaveAs2($Dst, 16)
  # 16 = wdFormatDocumentDefault (.docx)
  $doc.Close($false)
} finally {
  $word.Quit()
}
Write-Output "saved $Dst"
