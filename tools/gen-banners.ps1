# Regenerate club signage PNGs (team name / slogan / emblem) with Windows GDI+.
# ASCII-only on purpose: PowerShell 5.1 reads BOM-less files as ANSI, so Chinese lives in teams-identity.json.
# Run:  $c = Get-Content -Raw .\tools\gen-banners.ps1; Invoke-Expression $c
Add-Type -AssemblyName System.Drawing

$pack = Split-Path -Parent $PSScriptRoot          # ...\球场包
$root = Split-Path -Parent $pack                  # workspace root
$jsonPath = Join-Path $PSScriptRoot 'teams-identity.json'
$outDir = Join-Path $pack '04_队徽与标语'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
if (-not (Test-Path $jsonPath)) { $jsonPath = Join-Path $root '_work\teams-identity.json' }

$teams = Get-Content -Path $jsonPath -Raw -Encoding UTF8 | ConvertFrom-Json

function HexToColor([string]$hex) {
  $h = $hex.TrimStart('#')
  return [System.Drawing.Color]::FromArgb(255, [Convert]::ToInt32($h.Substring(0,2),16), [Convert]::ToInt32($h.Substring(2,2),16), [Convert]::ToInt32($h.Substring(4,2),16))
}
function Shade([System.Drawing.Color]$c, [double]$k) {
  $r = [Math]::Min(255, [Math]::Max(0, [int]($c.R * $k)))
  $g = [Math]::Min(255, [Math]::Max(0, [int]($c.G * $k)))
  $b = [Math]::Min(255, [Math]::Max(0, [int]($c.B * $k)))
  return [System.Drawing.Color]::FromArgb(255, $r, $g, $b)
}
function Lum([System.Drawing.Color]$c) { return (0.299*$c.R + 0.587*$c.G + 0.114*$c.B) }

foreach ($t in $teams) {
  $p = HexToColor $t.primary
  $s = HexToColor $t.secondary
  $onPrimary = if ((Lum $p) -gt 150) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::White }
  $onSecondary = if ((Lum $s) -gt 150) { [System.Drawing.Color]::Black } else { [System.Drawing.Color]::White }
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center

  # 1) name board 2048x320
  $bmp = New-Object System.Drawing.Bitmap 2048, 320
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $rect = New-Object System.Drawing.Rectangle 0, 0, 2048, 320
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, $p, (Shade $p 0.55), 0
  $g.FillRectangle($grad, $rect)
  $barBrush = New-Object System.Drawing.SolidBrush $s
  $g.FillRectangle($barBrush, 0, 0, 2048, 16)
  $g.FillRectangle($barBrush, 0, 304, 2048, 16)
  $white = New-Object System.Drawing.SolidBrush $onPrimary
  $fName = New-Object System.Drawing.Font('Microsoft YaHei', 132, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fSub = New-Object System.Drawing.Font('Microsoft YaHei', 44, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $g.DrawString($t.cn, $fName, $white, (New-Object System.Drawing.RectangleF 0, 30, 2048, 180), $fmt)
  $sub = $t.en + '  ·  ' + $t.venue
  $g.DrawString($sub, $fSub, $white, (New-Object System.Drawing.RectangleF 0, 210, 2048, 70), $fmt)
  $g.Dispose()
  $bmp.Save((Join-Path $outDir ($t.en + '_name.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()

  # 2) slogan band 2048x256
  $bmp2 = New-Object System.Drawing.Bitmap 2048, 256
  $g2 = [System.Drawing.Graphics]::FromImage($bmp2)
  $g2.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g2.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $rect2 = New-Object System.Drawing.Rectangle 0, 0, 2048, 256
  $bg2 = if ((Lum $s) -gt 210) { Shade $p 0.7 } else { $s }
  $grad2 = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect2, (Shade $bg2 1.05), (Shade $bg2 0.78), 0
  $g2.FillRectangle($grad2, $rect2)
  $text2 = if ((Lum $s) -gt 210) { [System.Drawing.Color]::White } else { $onSecondary }
  $brush2 = New-Object System.Drawing.SolidBrush $text2
  $fSlogan = New-Object System.Drawing.Font('Microsoft YaHei', 128, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $g2.DrawString($t.slogan, $fSlogan, $brush2, (New-Object System.Drawing.RectangleF 0, 0, 2048, 256), $fmt)
  $g2.Dispose()
  $bmp2.Save((Join-Path $outDir ($t.en + '_slogan.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp2.Dispose()

  # 3) emblem 1024x1024
  $bmp3 = New-Object System.Drawing.Bitmap 1024, 1024
  $g3 = [System.Drawing.Graphics]::FromImage($bmp3)
  $g3.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g3.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g3.Clear($p)
  $ring = New-Object System.Drawing.Pen $s, 34
  $g3.DrawEllipse($ring, 40, 40, 944, 944)
  $ring2 = New-Object System.Drawing.Pen (Shade $p 0.6), 14
  $g3.DrawEllipse($ring2, 92, 92, 840, 840)
  $brush3 = New-Object System.Drawing.SolidBrush $onPrimary
  $fEm = New-Object System.Drawing.Font('Microsoft YaHei', 560, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $g3.DrawString($t.emblem, $fEm, $brush3, (New-Object System.Drawing.RectangleF 0, 120, 1024, 800), $fmt)
  $g3.Dispose()
  $bmp3.Save((Join-Path $outDir ($t.en + '_emblem.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp3.Dispose()

  Write-Host ("drawn " + $t.en)
}
Write-Host "done"
