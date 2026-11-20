from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from hashlib import sha256
import json
import re
import sys

root=(Path(__file__).resolve().parents[2]/'.local'/'releases').resolve()
args=sys.argv[1:]
release=len(args)==2 and args[0]=='--release'
if len(args)!=1 and not release:
 raise SystemExit('用法：python tools/archive-candidate.py [--release] <本项目的打包目录>')
source=Path(args[-1]).resolve()
if source.parent!=root: raise SystemExit('只接受本项目 .local/releases 内的打包目录。')
if release:
 match=re.fullmatch(r'ClipNote-win-x64-(\d+\.\d+\.\d+)',source.name)
 info=json.loads((source/'build-info.json').read_text(encoding='utf-8'))
 if not match or info.get('bundling')!='windows-release' or info.get('sourceDirty') is not False or info.get('appVersion')!=match[1]:
  raise SystemExit('只接受版本一致且来自干净提交的 Windows 发布构建。')
 if (source/'内部候选-不可分发.txt').exists(): raise SystemExit('发布包含内部候选标识。')
elif not source.name.startswith('ClipNote-candidate-') or not (source/'内部候选-不可分发.txt').is_file():
 raise SystemExit('只接受本项目内带内部标识的候选目录。')
if (source/'resources'/'.local').exists(): raise SystemExit('打包目录含测试数据，请重新组装干净版本。')
output=root/(source.name+'.zip')
paths=sorted(source.rglob('*'))
if any(p.is_symlink() or not p.resolve().is_relative_to(source) for p in paths): raise SystemExit('打包目录包含符号链接或外部路径。')
files=[p for p in paths if p.is_file()]
with output.open('xb') as raw:
 with ZipFile(raw,'w',compression=ZIP_DEFLATED,compresslevel=6,allowZip64=True) as archive:
  for path in files: archive.write(path,Path('ClipNote')/path.relative_to(source))
hash=sha256()
with output.open('rb') as stream:
 for block in iter(lambda:stream.read(1024*1024),b''): hash.update(block)
if release:
 with (root/(output.name+'.sha256')).open('x',encoding='ascii') as checksum:
  checksum.write(f'{hash.hexdigest()}  {output.name}\n')
print(f'{output}\nSHA256 {hash.hexdigest()}\nfiles {len(files)}')
