import type {WorkspaceAction,WorkspaceActions,WorkspaceKind,WorkspaceResult} from '../contracts/workspace.ts';
export function unwrap<T>(result:WorkspaceResult<T>):T{if(result.status==='ok')return result.value;throw new Error(result.status==='error'?result.error.message:'已取消操作。');}
export async function workspaceValue<A extends WorkspaceAction>(kind:WorkspaceKind,action:A,...args:WorkspaceActions[A]['args']):Promise<WorkspaceActions[A]['value']>{return unwrap(await window.clipnote.workspace(kind,action,...args));}
