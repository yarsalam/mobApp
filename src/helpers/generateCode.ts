function generateOrderCode(): string {
  return (Date.now() % 1000000).toString().padStart(6, '0'); // مثل: 6 رقمی عددی
}
export default generateOrderCode;
