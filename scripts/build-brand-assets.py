#!/usr/bin/env python3
"""生成 README 品牌资产：wordmark（明/暗双版 SVG）+ banner（1440×360 PNG）。

wordmark = logo.svg 图标 + 排版字标（系统字体栈，SVG 内联无外部依赖）。
banner = 品牌蓝渐变底 + logo + 字标 + 定位语（Playwright 渲染 HTML → 截图，
保证字体渲染质量；输出到 docs/assets/banner.png）。

用法：python3 scripts/build-brand-assets.py（需本机可跑 Playwright——开发依赖已有）。
"""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'docs' / 'assets'
LOGO = (ASSETS / 'logo.svg').read_text()

# （wordmark SVG 双版方案已弃：GitHub 的 data-color-mode 不联动
# prefers-color-scheme——用户钉暗色主题而系统是浅色时，深色文字黑上黑
# 不可读。hero 改走自带品牌底色的 banner，主题无关。）

# ── banner：1440×360 品牌横幅（中英双版；主题无关——自带品牌底色）──
def banner_html(tagline: str) -> str:
    return f"""<!doctype html>
<html><body style="margin:0">
<div style="width:1440px;height:360px;display:flex;align-items:center;justify-content:center;gap:40px;
  background:linear-gradient(135deg,#3B5BFD 0%,#2743D8 60%,#1E36B8 100%);
  font-family:-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif;position:relative;overflow:hidden">
  <!-- 右侧淡淡的界面隐喻：主区块 + 侧栏 -->
  <div style="position:absolute;right:-60px;top:40px;width:520px;height:280px;border:2px solid rgba(255,255,255,0.18);border-radius:16px;transform:rotate(-2deg)">
    <div style="position:absolute;right:0;top:0;width:150px;height:280px;border-left:2px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);border-radius:0 14px 14px 0"></div>
  </div>
  <div style="width:128px;height:128px;flex:none">{LOGO}</div>
  <div>
    <div style="color:#fff;font-size:64px;font-weight:700;letter-spacing:-2px;line-height:1.05;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">dsh-sidenote</div>
    <div style="color:rgba(255,255,255,0.85);font-size:26px;margin-top:14px;letter-spacing:0.2px">{tagline}</div>
  </div>
</div>
</body></html>"""


def banner(tagline: str, name: str) -> None:
    script = ROOT / 'scripts' / '.tmp-banner.mjs'
    script.write_text(f"""
import {{ chromium }} from '@playwright/test'
const browser = await chromium.launch()
const page = await browser.newPage({{ viewport: {{ width: 1440, height: 360 }}, deviceScaleFactor: 2 }})
await page.setContent({banner_html(tagline)!r})
await page.screenshot({{ path: {str(ASSETS / name)!r} }})
await browser.close()
console.log('banner ok')
""")
    subprocess.run(['node', str(script)], check=True, cwd=ROOT)
    script.unlink()
    print(f'banner → {name}')


banner('侧边开一岔对话，划选留一条注释——主线永不被打断', 'banner.png')
banner('Side lanes for side questions. Notes on any passage.', 'banner-en.png')
