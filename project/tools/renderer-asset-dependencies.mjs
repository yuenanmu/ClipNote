export function rendererAssetDependencies(ids) {
  const paths=new Set();
  for (const id of ids) {
    if (id.startsWith('\0')) continue;
    const path=id.split('?')[0];
    if (/(^|[/\\])node_modules[/\\]/.test(path) && /\.(css|scss|sass|less|styl|woff2?|ttf|otf|svg|png|jpe?g|gif|webp|avif)$/i.test(path)) paths.add(path);
  }
  return [...paths].map(path=>({path,group:'renderer'}));
}
