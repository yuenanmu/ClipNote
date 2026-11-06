let transport: typeof fetch | undefined;
export function setSubscriptionTransport(value: typeof fetch): void { transport = value; }
export const subscriptionFetch: typeof fetch = (input, init) => {
  if (!transport) throw new Error('SUBSCRIPTION_TRANSPORT_UNAVAILABLE');
  return transport(input, init);
};