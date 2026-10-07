export interface RegisterStep1Dto {
  phone: string;
  gender: string;
  recaptchaToken?: string;
}
export interface verifyCodeDto {
  phone: string;
  code: string;
}

export interface JwtPayload {
  sub: number;
  phone: string;
  temporary?: boolean;
}
