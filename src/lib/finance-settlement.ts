export type SaudiSubscriptionRefund = { retainedSarMinor: bigint; refundBeforeFeeSarMinor: bigint; returnFeeSarMinor: bigint; refundToClientSarMinor: bigint };

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
  const retainedSarMinor = individualWorkSarMinor < contractSarMinor ? individualWorkSarMinor : contractSarMinor;
  const refundBeforeFeeSarMinor = paidSarMinor > retainedSarMinor ? paidSarMinor - retainedSarMinor : 0n;
  if (actualReturnFeeSarMinor > refundBeforeFeeSarMinor) throw new Error('رسم إعادة التحويل يتجاوز مبلغ الاسترداد');
  return { retainedSarMinor, refundBeforeFeeSarMinor, returnFeeSarMinor: actualReturnFeeSarMinor, refundToClientSarMinor: refundBeforeFeeSarMinor - actualReturnFeeSarMinor };
}
