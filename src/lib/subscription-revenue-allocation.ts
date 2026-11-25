export type RevenueShare = { projectId: string; kind: 'VIDEO' | 'POSTER'; amountMinor: bigint };

export function validateSubscriptionRevenueAllocation(shares: RevenueShare[], contractMinor: bigint): RevenueShare[] {
  if (contractMinor <= 0n || shares.length !== 6 ||
      shares.filter(share => share.kind === 'VIDEO').length !== 3 ||
      shares.filter(share => share.kind === 'POSTER').length !== 3 ||
      new Set(shares.map(share => share.projectId)).size !== 6 ||
      shares.some(share => !share.projectId || share.amountMinor <= 0n) ||
      shares.reduce((sum, share) => sum + share.amountMinor, 0n) !== contractMinor)
    throw new Error('توزيع الاشتراك يحتاج ستة أعمال فريدة وثلاثة فيديوهات وثلاثة بوسترات ومجموعًا يطابق قيمة الاتفاق');
  return shares;
}
