export interface IChannelSender {
  sendCode(phone: string, code: string): Promise<boolean>;
}
