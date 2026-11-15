from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from hashlib import sha256
import sys

root=(Path(__file__).resolve().parents[2]/'.local'/'releases').resolve()
if len(sys.argv)!=2: raise SystemExit('用法：python tools/archive-candidate.py <内部候选目录>')
source=Path(sys.argv[1]).resolve()
if source.parent!=root or not source.name.startswith('ClipNote-candidate-') or not (source/'内部候选-不可分发.txt').is_file(): raise SystemExit('只接受本项目内带内部标识的候选目录。')
if (source/'resources'/'.local').exists(): raise SystemExit('候选含测试数据，请重新组装干净候选。')
output=root/(source.name+'.zip')
files=sorted(p for p in source.rglob('*') if p.is_file())
if any(p.is_symlink() or not p.resolve().is_relative_to(source) for p in source.rglob('*')): raise SystemExit('候选包含符号链接或外部路径。')
with output.open('xb') as raw:
 with ZipFile(raw,'w',compression=ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
  for path in files: archive.write(path,Path('ClipNote')/path.relative_to(source))
hash=sha256()
with output.open('rb') as stream:
 for block in iter(lambda:stream.read(1024*1024),b''): hash.update(block)
print(f'{output}\nSHA256 {hash.hexdigest()}\nfiles {len(files)}')
