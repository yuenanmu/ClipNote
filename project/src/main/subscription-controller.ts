type Action = 'state' | 'signIn' | 'cancel' | 'models' | 'disconnect';
type Client = Partial<{ getSession(): Promise<unknown>; signIn(): Promise<unknown>; cancelSignIn(): void; listModels(): Promise<unknown>; disconnect(): Promise<void> }>;
const messages: Record<string, string> = { revocation_failed:'本地登录凭据已清除，但远端撤销未确认；请在 ChatGPT 设置中断开此应用。', storage_encryption_unavailable:'系统加密存储不可用，请检查 Windows 登录与凭据保护后重试。', storage_invalid:'无法读取已保存的登录信息，请检查本机数据。', storage_error:'无法安全读取或保存登录信息，请检查本机权限。', sign_in_required:'请先登录 ChatGPT。', sharing_not_enabled:'当前账户未启用订阅共享，请重新授权。', refresh_not_ready:'登录信息暂时无法刷新，请稍后重试。',  cancelled: '登录已取消。', network_error: '无法连接登录服务，请检查网络。', access_denied: '授权未完成。', subscription_sharing_user_not_eligible: '当前账户无法使用订阅共享。', subscription_sharing_usage_limit_exceeded: '订阅使用额度已达到限制。' };
function safeSession(value: any) {
  const identity = value?.identity;
  return {status:value.status, sharing:value.sharing, ...(typeof value.profileId === 'string' ? {profileId:value.profileId} : {}), ...(value?.error && typeof value.error.code === 'string' && Object.hasOwn(messages,value.error.code) ? {error:{code:value.error.code,message:messages[value.error.code]}} : {}), ...(identity ? {identity:{...(typeof identity.name === 'string' ? {name:identity.name} : {}), ...(typeof identity.email === 'string' ? {email:identity.email} : {})}} : {})};
}
export function createSubscriptionHandlers(client: Client, trusted: (event: unknown) => boolean, cancelTask: (event:unknown)=>void | Promise<unknown> = ()=>{}): Record<Action, (event: unknown, ...args: unknown[]) => Promise<any>> {
  let busy = false;
  const handle = (action: Action) => async (event: unknown, ...args: unknown[]) => {
    if (!trusted(event) || args.length) return {status:'error', error:{code:'FORBIDDEN_REQUEST', message:'无法执行此操作。'}};
    if (action === 'cancel') { client.cancelSignIn?.(); return {status:'ok', value:null}; }
    if (action === 'state') { try { return {status:'ok', value:safeSession(await client.getSession!())}; } catch { return {status:'error', error:{code:'storage_error', message:'无法读取订阅连接。'}}; } }
    if (busy) return {status:'error', error:{code:'busy', message:'连接操作正在进行。'}};
    busy = true;
    try {
      if(action === 'signIn' || action === 'disconnect') await cancelTask(event);
      const value = action === 'signIn' ? await client.signIn!() : action === 'models' ? await client.listModels!() : await client.disconnect!();
      return {status:'ok', value:action === 'signIn' ? safeSession(value) : action === 'models' ? (value as any[]).map(item => ({slug:item.slug, displayName:item.displayName})) : null};
    } catch (error) {
      const candidate = (error as {code?:string})?.code;
      const code = candidate && Object.hasOwn(messages, candidate) ? candidate : 'connection_error';
      return {status:'error', error:{code, message:messages[code] ?? '订阅连接未完成，请稍后重试。'}};
    } finally { busy = false; }
  };
  return {state:handle('state'), signIn:handle('signIn'), cancel:handle('cancel'), models:handle('models'), disconnect:handle('disconnect')};
}
