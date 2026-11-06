import {dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import electronPath from 'electron';
export function electronTestTarget(){
 const requested=process.env.CLIPNOTE_PACKAGE_TEST_EXE;
 if(!requested)return {executablePath:electronPath,args:[fileURLToPath(new URL('../../dist/main/index.cjs',import.meta.url))],artifacts:fileURLToPath(new URL('../../../.local/test-artifacts/',import.meta.url))};
 const executablePath=resolve(requested),releaseRoot=fileURLToPath(new URL('../../../.local/releases/',import.meta.url)),diff=relative(releaseRoot,executablePath);
 if(isAbsolute(diff)||diff.startsWith('..')||!diff || !/^ClipNote-candidate-[^\\/]+[\\/]ClipNote\.exe$/i.test(diff))throw new Error('打包测试只接受本项目内部候选程序。');
 return {executablePath,args:[],artifacts:join(dirname(executablePath),'resources','.local','test-artifacts')};
}
