export function createSubscriptionFetch(systemFetch: typeof fetch): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (!['https://auth.openai.com', 'https://api.openai.com'].includes(url.origin) || url.username || url.password) {
      throw new Error('SUBSCRIPTION_ENDPOINT_REJECTED');
    }
    const request = new Request(input, { ...init, redirect: 'error', credentials: 'omit' });
    request.signal.throwIfAborted();
    return systemFetch(request);
  };
}
