import {cp,mkdir,rename,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

// Internal experiment only. An existing output directory is never replaced.
export async function assembleBundledExperiment({runtimeDir,buildDir,projectRoot,outputDir}) {
  const out=resolve(outputDir),root=resolve(projectRoot);
  await mkdir(out);
  await cp(runtimeDir,out,{recursive:true});
  await rename(join(out,'electron.exe'),join(out,'ClipNote.exe'));
  const app=join(out,'resources','app');await mkdir(app,{recursive:true});
  await cp(join(buildDir,'dist'),join(app,'dist'),{recursive:true});
  await writeFile(join(app,'package.json'),JSON.stringify({name:'clipnote',productName:'ClipNote',version:'0.1.0-candidate',main:'dist/main/index.cjs'},null,2));
  await cp(resolve(root,'../docs/Windows候选使用说明.md'),join(out,'使用说明.md'));
  const notices=join(out,'licenses');await mkdir(notices);
  await cp(join(buildDir,'npm-notices'),join(notices,'npm'),{recursive:true});
  await cp(join(root,'vendor/siwc/LICENSE'),join(notices,'SIWC-LICENSE.txt'));
  await cp(join(root,'vendor/siwc/THIRD_PARTY_NOTICES.md'),join(notices,'SIWC-THIRD-PARTY.md'));
  await cp(join(root,'licenses/SIWC-CHANGES.md'),join(notices,'SIWC-CHANGES.md'));
  await cp(join(root,'vendor/siwc/src'),join(notices,'siwc-modified-source'),{recursive:true});
  await writeFile(join(out,'内部候选-不可分发.txt'),'此目录仅用于开发测试。依赖许可证、目标电脑与真实服务验收尚未完成，请勿分发。\n');
}
