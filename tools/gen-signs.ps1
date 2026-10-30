# gen-signs.ps1 - interior wayfinding signs (Chinese labels) via GDI+
# run: $PSScriptRoot='...\tools'; Invoke-Expression (Get-Content -Raw .\tools\gen-signs.ps1)
Add-Type -AssemblyName System.Drawing

$pack = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $pack '04_队徽与标语\signs'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$signs = @(
  @{ en = 'toilet';   cn = '卫 生 间';       accent = '#1E6FA8' },
  @{ en = 'changing'; cn = '更 衣 室';       accent = '#2E7D4F' },
  @{ en = 'media';    cn = '媒 体 区';       accent = '#8A5A1E' },
  @{ en = 'kiosk';    cn = '小 卖 部';       accent = '#A03A2A' },
  @{ en = 'exit';     cn = '出 口';          accent = '#1F7A3F' },
  @{ en = 'security'; cn = '安 检';          accent = '#5A4A7A' },
  @{ en = 'stand';    cn = '看 台 入 口';    accent = '#1E6FA8' },
  @{ en = 'firstaid'; cn = '急 救';          accent = '#B03A2E' },
  @{ en = 'ticket';   cn = '售 票 处';       accent = '#1E6FA8' },
  @{ en = 'shop';     cn = '球 迷 商 店';    accent = '#2E7D4F' },
  @{ en = 'vip';      cn = 'VIP 休 息 室';   accent = '#8A6A1E' },
  @{ en = 'press';    cn = '新 闻 发 布 厅'; accent = '#5A4A7A' },
  @{ en = 'doping';   cn = '药 检 室';       accent = '#1F7A6F' },
  @{ en = 'storage';  cn = '储 藏 室';       accent = '#6A6A6A' },
  @{ en = 'family';   cn = '家 庭 区';       accent = '#A03A2A' },
  @{ en = 'home';     cn = '主 队 更 衣 室'; accent = '#2E7D4F' },
  @{ en = 'away';     cn = '客 队 更 衣 室'; accent = '#1E6FA8' },
  @{ en = 'kitchen';  cn = '餐 饮 后 厨';    accent = '#A03A2A' }
)

function HexToColor([string]$hex) {
  $h = $hex.TrimStart('#')
  [System.Drawing.Color]::FromArgb(255, [Convert]::ToInt32($h.Substring(0,2),16), [Convert]::ToInt32($h.Substring(2,2),16), [Convert]::ToInt32($h.Substring(4,2),16))
}

foreach ($s in $signs) {
  $bmp = New-Object System.Drawing.Bitmap 512, 160
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::FromArgb(255, 24, 26, 28))
  $accent = HexToColor $s.accent
  $brushA = New-Object System.Drawing.SolidBrush $accent
  $g.FillRectangle($brushA, 0, 0, 14, 160)
  $g.FillRectangle($brushA, 0, 150, 512, 10)
  $white = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $f = New-Object System.Drawing.Font('Microsoft YaHei', 54, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $g.DrawString($s.cn, $f, $white, (New-Object System.Drawing.RectangleF 14, 0, 498, 150), $fmt)
  $g.Dispose()
  $bmp.Save((Join-Path $outDir ($s.en + '.png')), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host ("sign " + $s.en)
}
Write-Host "done"
