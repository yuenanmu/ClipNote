import {build as bundle} from 'esbuild';
import {build as buildRenderer} from 'vite';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectEmbeddedPackages} from './embedded-packages.mjs';
import {createNoticeDraft} from './bundle-notice-draft.mjs';
import {rendererAssetDependencies} from './renderer-asset-dependencies.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const parent=resolve(root,'../.local/bundle-experiments');
await mkdir(parent,{recursive:true});
const output=await mkdtemp(join(parent,'experiment-'));
const entries={index:'src/main/index.ts',preload:'src/preload/index.ts','source-worker':'src/main/source-worker.ts','storage-worker':'src/main/storage-worker.ts','reader-worker':'src/main/reader-worker.ts','analysis-worker':'src/main/analysis-worker.ts'};
const main=await bundle({absWorkingDir:root,entryPoints:entries,outdir:join(output,'dist/main'),outExtension:{'.js':'.cjs'},bundle:true,platform:'node',target:'node24',format:'cjs',external:['electron'],sourcemap:true,metafile:true});
const sources=new Map();
// Include all input modules, even if tree-shaken, as a conservative notice draft.
for (const file of Object.keys(main.metafile.inputs)) {
  if (/(^|[/\\])node_modules[/\\]/.test(file)) sources.set(`main:${file}`,{path:resolve(root,file),group:'main'});
}
await buildRenderer({configFile:false,root:join(root,'src/renderer'),base:'./',build:{outDir:join(output,'dist/renderer'),emptyOutDir:true},plugins:[{
  name:'clipnote-internal-inventory',
  generateBundle(_options,outputs) {
    for (const output of Object.values(outputs)) if (output.type==='chunk') {
      for (const [id,info] of Object.entries(output.modules)) {
        if (info.renderedLength>0 && /(^|[/\\])node_modules[/\\]/.test(id)) {
          const path=id.split('?')[0];sources.set(`renderer:${path}`,{path,group:'renderer'});
        }
      }
    }
    // CSS and asset modules may not contribute rendered JavaScript bytes.
    for (const item of rendererAssetDependencies([...this.getModuleIds()])) sources.set(`renderer:${item.path}`,item);
  },
}]});
const packages=await collectEmbeddedPackages({projectRoot:root,files:[...sources.values()]});
const notices=await createNoticeDraft({projectRoot:root,outputDir:join(output,'npm-notices'),packages});
await writeFile(join(output,'内部实验-不可分发.txt'),'仅用于验证按需构建；缺少完整许可审查及真实环境验收，不可分发。\n');
console.log(`Internal experiment: ${output}\nDependency notices: ${notices.length}`);
