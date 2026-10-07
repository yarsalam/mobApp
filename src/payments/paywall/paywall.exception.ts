export class PaywallException extends Error {
  constructor(public payload: any) {
    super('PAYWALL');
  }
}
