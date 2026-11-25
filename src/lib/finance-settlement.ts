export type SaudiSubscriptionRefund = { retainedSarMinor: bigint; refundBeforeFeeSarMinor: bigint; returnFeeSarMinor: bigint; refundToClientSarMinor: bigint };

export type CancellationSettlement = {
  paidMinor: bigint;
  workValueMinor: bigint;
  employeeDueMinor: bigint;
  documentedCostMinor: bigint;
  retainedMinor: bigint;
  returnFeeMinor: bigint;
  refundMinor: bigint;
};

export function calculateCancellationSettlement(input: CancellationSettlement): CancellationSettlement {
  const amounts = Object.values(input);
  if (amounts.some(amount => amount < 0n) || input.paidMinor === 0n)
    throw new Error('مبالغ التسوية يجب أن تكون موجبة أو صفرًا مع وجود تحصيل مؤكد');
  if (input.retainedMinor + input.returnFeeMinor + input.refundMinor !== input.paidMinor)
    throw new Error('المبلغ المحتفظ به ورسوم الرد والمبلغ المسترد يجب أن يساووا أصل ما دفعه العميل');
  if (input.returnFeeMinor > 0n && input.refundMinor === 0n)
    throw new Error('رسوم الرد تتطلب استردادًا فعليًا');
  return input;
}

export function calculateSaudiSubscriptionRefund(input: {
  contractSarMinor: bigint;
  paidSarMinor: bigint;
  acceptedVideos: number;
  acceptedPosters: number;
  unsettledStartedWork: boolean;
  actualReturnFeeSarMinor: bigint;
}): SaudiSubscriptionRefund {
  const { contractSarMinor, paidSarMinor, acceptedVideos, acceptedPosters, unsettledStartedWork, actualReturnFeeSarMinor } = input;
  if (contractSarMinor <= 0n || paidSarMinor < 0n || paidSarMinor > contractSarMinor || actualReturnFeeSarMinor < 0n || !Number.isSafeInteger(acceptedVideos) || !Number.isSafeInteger(acceptedPosters) || acceptedVideos < 0 || acceptedVideos > 3 || acceptedPosters < 0 || acceptedPosters > 3) throw new Error('بيانات دورة الاشتراك أو الأعمال الفعلية غير صالحة');
  if (unsettledStartedWork) throw new Error('عمل بدأ ولم يُستكمل ويُقبل بعد، يلزم قرار تسوية قبل الاسترداد النهائي');
  const individualWorkSarMinor = BigInt(acceptedVideos) * 45000n + BigInt(acceptedPosters) * 5000n;
  const retainedSarMinor = individualWorkSarMinor < paidSarMinor ? individualWorkSarMinor : paidSarMinor;
  const refundBeforeFeeSarMinor = paidSarMinor > retainedSarMinor ? paidSarMinor - retainedSarMinor : 0n;
  if (actualReturnFeeSarMinor > refundBeforeFeeSarMinor) throw new Error('رسم إعادة التحويل يتجاوز مبلغ الاسترداد');
  return { retainedSarMinor, refundBeforeFeeSarMinor, returnFeeSarMinor: actualReturnFeeSarMinor, refundToClientSarMinor: refundBeforeFeeSarMinor - actualReturnFeeSarMinor };
}
