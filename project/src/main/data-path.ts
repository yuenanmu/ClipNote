import {join} from 'node:path';
export function desktopDataPath(options:{packaged:boolean;projectRoot:string;appData:string}):string {
 return options.packaged ? join(options.appData,'ClipNote') : join(options.projectRoot,'.local','desktop');
}
