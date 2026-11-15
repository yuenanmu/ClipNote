import test from 'node:test';
import assert from 'node:assert/strict';
import {desktopDataPath} from '../../src/main/data-path.ts';
test('packaged data uses the user profile while development retains its project directory',()=>{
 assert.equal(desktopDataPath({packaged:true,projectRoot:'C:\\app',appData:'C:\\Users\\test\\AppData\\Roaming'}),'C:\\Users\\test\\AppData\\Roaming\\ClipNote');
 assert.equal(desktopDataPath({packaged:false,projectRoot:'C:\\app',appData:'C:\\user'}),'C:\\app\\.local\\desktop');
});
