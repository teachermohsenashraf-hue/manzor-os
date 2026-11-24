// Approved reference amounts are in EGP minor units, independent of Saudi sale prices in SAR
export type ApprovedService = 'EG_POSTER' | 'EG_MOTION' | 'EG_VIDEO_3_POSTERS' | 'SA_POSTER' | 'SA_MOTION' | 'SA_VIDEO_POSTER' | 'SA_SUBSCRIPTION';
export type Allocation = { communicationMinor: bigint; executionMinor: bigint; developmentMinor: bigint; developmentFractionTenthMinor: bigint; expenseMinor: bigint; roundingSuspenseMinor: bigint; distributableMinor: bigint; charityMinor: bigint; ownerFamilyMinor: bigint };

const egypt: Partial<Record<ApprovedService, { communication: bigint; execution: bigint }>> = {
  EG_POSTER: { communication: 1500n, execution: 5000n },
  EG_MOTION: { communication: 5000n, execution: 25000n },
  EG_VIDEO_3_POSTERS: { communication: 7500n, execution: 35000n },
};
const saudi: Partial<Record<ApprovedService, { communication: bigint; execution: bigint; development: bigint }>> = {
  SA_POSTER: { communication: 10000n, execution: 25000n, development: 10000n },
  SA_MOTION: { communication: 25000n, execution: 100000n, development: 40000n },
  SA_VIDEO_POSTER: { communication: 35000n, execution: 125000n, development: 40000n },
  SA_SUBSCRIPTION: { communication: 100000n, execution: 600000n, development: 200000n },
};

export function approvedEarningAmount(service: ApprovedService, kind: 'COMMUNICATION' | 'EXECUTION'): bigint {
  const rule = egypt[service] ?? saudi[service];
  if (!rule) throw new Error('الخدمة غير معتمدة في جدول المستحقات');
  return kind === 'COMMUNICATION' ? rule.communication : rule.execution;
}

export function approvedDevelopmentAmount(service: ApprovedService, agreedEgpMinor?: bigint): bigint {
  if (service.startsWith('EG_')) {
    if (agreedEgpMinor === undefined || agreedEgpMinor <= 0n) throw new Error('يلزم السعر المصري المتفق عليه');
    if (agreedEgpMinor % 10n !== 0n) throw new Error('فرق تقريب مخصص التطوير يحتاج تسوية موثقة قبل ترحيله');
    return agreedEgpMinor / 10n;
  }
  const amount = saudi[service]?.development;
  if (amount === undefined) throw new Error('خدمة التطوير غير معتمدة');
  return amount;
}

export function calculateApprovedAllocation(input: {
  service: ApprovedService;
  realizedEgpMinor: bigint;
  agreedEgpMinor?: bigint;
  expenseEgpMinor?: bigint;
  ownerExecuted: boolean;
}): Allocation {
  const { service, realizedEgpMinor, agreedEgpMinor, ownerExecuted } = input;
  const expenseMinor = input.expenseEgpMinor ?? 0n;
  if (realizedEgpMinor < 0n || expenseMinor < 0n || agreedEgpMinor !== undefined && agreedEgpMinor < 0n) throw new Error('المبالغ يجب أن تكون غير سالبة');
  const eg = egypt[service], sa = saudi[service];
  if (!eg && !sa) throw new Error('الخدمة غير معتمدة في جدول المرحلة الخامسة');
  if (eg && agreedEgpMinor === undefined) throw new Error('يلزم السعر المصري المتفق عليه لحساب مخصص التطوير');
  const communicationMinor = (eg ?? sa)!.communication;
  const executionMinor = ownerExecuted ? 0n : (eg ?? sa)!.execution;
  const developmentMinor = eg ? agreedEgpMinor! / 10n : sa!.development;
  const developmentFractionTenthMinor = eg ? agreedEgpMinor! % 10n : 0n;
  const beforeRounding = realizedEgpMinor - communicationMinor - executionMinor - developmentMinor - expenseMinor;
  const developmentHold = developmentFractionTenthMinor > 0n ? 1n : 0n;
  if (beforeRounding < developmentHold) throw new Error('لا يوجد فائض قابل للتوزيع بعد الالتزامات');
  const roundingSuspenseMinor = developmentHold + (beforeRounding - developmentHold) % 2n;
  const distributableMinor = beforeRounding - roundingSuspenseMinor;
  const charityMinor = distributableMinor / 2n;
  return { communicationMinor, executionMinor, developmentMinor, developmentFractionTenthMinor, expenseMinor, roundingSuspenseMinor, distributableMinor, charityMinor, ownerFamilyMinor: distributableMinor - charityMinor };
}
