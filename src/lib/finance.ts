import type { Tx } from './idempotency';

export async function confirmedOrderPaidMinor(tx: Tx, orderId: string): Promise<bigint> {
  const [native, converted] = await Promise.all([
    tx.receipt.aggregate({ where: { orderId }, _sum: { grossMinor: true } }),
    tx.fxReceipt.aggregate({ where: { orderId }, _sum: { paidSarMinor: true } }),
  ]);
  return (native._sum.grossMinor ?? 0n) + (converted._sum.paidSarMinor ?? 0n);
}

export function validateFxAmounts(input: { paidSarMinor: bigint; netEgpMinor: bigint; grossEgpMinor: bigint | null; feeEgpMinor: bigint | null }): void {
  if (input.paidSarMinor <= 0n || input.netEgpMinor <= 0n) throw new Error('مبالغ التحويل يجب أن تكون موجبة');
  if ((input.grossEgpMinor === null) !== (input.feeEgpMinor === null)) throw new Error('أدخل إجمالي التحويل والرسوم معًا أو اتركهما مجهولين');
  if (input.grossEgpMinor !== null && (input.feeEgpMinor! < 0n || input.grossEgpMinor !== input.netEgpMinor + input.feeEgpMinor!)) throw new Error('صافي الوصول يجب أن يساوي إجمالي التحويل ناقص الرسوم مرة واحدة');
}

export function validateFxRate(rate: string, paidSarMinor: bigint, receivedEgpMinor: bigint): void {
  if (!/^\d{1,6}(\.\d{1,12})?$/.test(rate) || !/[1-9]/.test(rate) || paidSarMinor <= 0n || receivedEgpMinor <= 0n) throw new Error('سعر الصرف الفعلي غير صالح');
  const [whole, fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole) * scale + BigInt(fraction || '0');
  const calculated = (paidSarMinor * numerator + scale / 2n) / scale;
  if (calculated < receivedEgpMinor - 1n || calculated > receivedEgpMinor + 1n) throw new Error('سعر الصرف لا يطابق المبلغ الفعلي في حدود أصغر وحدة نقدية');
}
