export type PaywallProduct = 'boost' | 'credits' | 'vip' | 'bundle';

export interface PaywallAction {
  product: PaywallProduct;
  productId: string;
  label: string;
  highlight?: boolean;
}

export interface PaywallResponse {
  title: string;
  description: string;
  tone: 'educational' | 'soft_sell' | 'hard_sell';
  primaryAction: PaywallAction;
  secondaryAction?: PaywallAction;
}
