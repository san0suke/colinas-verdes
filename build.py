"""Gera o bundle de página única para publicar como Artifact.

Uso: python build.py [saida.html]
- inline dos scripts locais (<script src="...">)
- PNGs de assets/ viram data URIs
- remove doctype/html/head/body (o Artifact envolve o conteúdo na própria casca)
"""
import base64, re, sys, os

ROOT = os.path.dirname(os.path.abspath(__file__))
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'colinas-verdes.html')

html = open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()

def inline_script(m):
    src = m.group(1)
    js = open(os.path.join(ROOT, src), encoding='utf-8').read()
    js = re.sub(r"'(assets/[^']+\.png)'", lambda a: "'data:image/png;base64," + base64.b64encode(open(os.path.join(ROOT, a.group(1)), 'rb').read()).decode() + "'", js)
    return '<script>\n' + js + '\n</script>'

html = re.sub(r'<script src="([^"]+)"></script>', inline_script, html)

head = re.search(r'<head>(.*?)</head>', html, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
head = re.sub(r'<meta[^>]*>\s*', '', head)  # charset/viewport já vêm da casca
bundle = head.strip() + '\n' + body.strip() + '\n'

os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, 'w', encoding='utf-8').write(bundle)
print(out, len(bundle.encode('utf-8')) // 1024, 'KB')
