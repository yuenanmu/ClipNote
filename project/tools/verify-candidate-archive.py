from pathlib import Path
from tempfile import mkdtemp
from zipfile import ZipFile
import sys
root=(Path(__file__).resolve().parents[2]/'.local'/'releases').resolve()
if len(sys.argv)!=2: raise SystemExit('用法：python tools/verify-candidate-archive.py <候选压缩包>')
archive=Path(sys.argv[1]).resolve()
if archive.parent!=root or not archive.name.startswith('ClipNote-candidate-') or archive.suffix!='.zip': raise SystemExit('仅接受本项目内部候选压缩包。')
dest=Path(mkdtemp(prefix='archive-check-',dir=root))
with ZipFile(archive) as z:
 for item in z.infolist():
  target=(dest/item.filename).resolve()
  if not target.is_relative_to(dest) or not item.filename.startswith('ClipNote/'): raise SystemExit('压缩包包含不安全路径。')
 z.extractall(dest)
app=dest/'ClipNote'
for name in ['ClipNote.exe','使用说明.md','内部候选-不可分发.txt','licenses/SIWC-LICENSE.txt']:
 if not (app/name).is_file(): raise SystemExit('缺少文件：'+name)
print(app)
