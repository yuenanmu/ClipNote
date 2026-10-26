import { build as bundle } from 'esbuild';
import { build as buildRenderer } from 'vite';
await bundle({ entryPoints: { index: 'src/main/index.ts', preload: 'src/preload/index.ts', 'source-worker': 'src/main/source-worker.ts' }, outdir: 'dist/main', outExtension: { '.js': '.cjs' }, bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'], sourcemap: true });
await buildRenderer();
