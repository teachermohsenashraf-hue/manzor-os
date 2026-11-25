export function validSaudiSubscriptionOffer(
  price: { marketCode: string; currency: string; amountMinor: bigint },
  parts: { quantity: number; child: { productionType: string } }[],
) {
  return price.marketCode === 'SA' && price.currency === 'SAR' && price.amountMinor === 130000n &&
    parts.length === 2 && parts.some(part => part.child.productionType === 'VIDEO' && part.quantity === 3) &&
    parts.some(part => part.child.productionType === 'POSTER' && part.quantity === 3);
}
