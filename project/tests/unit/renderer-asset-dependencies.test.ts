import test from 'node:test';
import assert from 'node:assert/strict';
import {rendererAssetDependencies} from '../../tools/renderer-asset-dependencies.mjs';

test('includes third-party styles and fonts, stripping bundler queries',()=>{
  const result=rendererAssetDependencies([
    'C:/work/node_modules/example/theme.css?direct',
    'C:\\work\\node_modules\\example\\font.woff2',
    'C:/work/src/app.css',
    'C:/work/node_modules/example/index.js',
  ]);
  assert.deepEqual(result,[
    {path:'C:/work/node_modules/example/theme.css',group:'renderer'},
    {path:'C:\\work\\node_modules\\example\\font.woff2',group:'renderer'},
  ]);
});
