import {spawnSync} from 'node:child_process';
if(!process.env.CLIPNOTE_PACKAGE_TEST_EXE){console.error('请设置 CLIPNOTE_PACKAGE_TEST_EXE，指向内部候选 ClipNote.exe。测试会在候选目录内写入隔离测试资料。');process.exit(1);}
const result=spawnSync(process.execPath,['--test','--test-concurrency=1','tests/e2e/batch.test.mjs','tests/e2e/smartsub-task.test.mjs','tests/e2e/subscription.test.mjs'],{stdio:'inherit',env:process.env});if(result.error)throw result.error;process.exit(result.status??1);
