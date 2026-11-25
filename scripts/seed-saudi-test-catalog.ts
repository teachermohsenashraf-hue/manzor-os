import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const source = process.env.DIRECT_URL;
if (!source) throw new Error('DIRECT_URL مطلوب');
const url = new URL(source);
if (!['postgresql:', 'postgres:'].includes(url.protocol) ||
    !`${url.hostname} ${url.username}`.includes('qepccducwytxchzstgsh'))
  throw new Error('الأمر مخصص لمشروع Supabase الحالي فقط');
url.searchParams.set('schema', 'manzoor_test');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url.toString() }, { schema: 'manzoor_test' }) });

try {
  const owner = await db.user.findFirst({ where: { role: 'OWNER', username: { startsWith: 'op_owner_' } }, select: { id: true } });
  if (!owner) throw new Error('حساب مالك الاختبار غير موجود في manzoor_test');
  await db.$transaction(async tx => {
    const video = await tx.service.upsert({ where: { code: 'TEST_SA_VIDEO' }, update: {},
      create: { code: 'TEST_SA_VIDEO', name: 'فيديو اختبار سعودي', kind: 'SINGLE', productionType: 'VIDEO', active: false } });
    const poster = await tx.service.upsert({ where: { code: 'TEST_SA_POSTER' }, update: {},
      create: { code: 'TEST_SA_POSTER', name: 'بوستر اختبار سعودي', kind: 'SINGLE', productionType: 'POSTER', active: false } });
    const monthly = await tx.service.upsert({ where: { code: 'TEST_SA_MONTHLY' }, update: {},
      create: { code: 'TEST_SA_MONTHLY', name: 'اشتراك سعودي تجريبي 1300 ريال', kind: 'SUBSCRIPTION', productionType: 'MIXED', active: true } });
    if (monthly.kind !== 'SUBSCRIPTION' || video.productionType !== 'VIDEO' || poster.productionType !== 'POSTER')
      throw new Error('كتالوج الاختبار الموجود غير مطابق');
    for (const childId of [video.id, poster.id])
      await tx.serviceComponent.upsert({ where: { parentId_childId: { parentId: monthly.id, childId } },
        update: { quantity: 3 }, create: { parentId: monthly.id, childId, quantity: 3 } });
    const from = new Date('2020-01-01T00:00:00.000Z');
    const price = await tx.priceVersion.upsert({ where: { serviceId_marketCode_effectiveFrom: { serviceId: monthly.id, marketCode: 'SA', effectiveFrom: from } },
      update: {}, create: { serviceId: monthly.id, marketCode: 'SA', currency: 'SAR', amountMinor: 130000n, effectiveFrom: from, createdById: owner.id } });
    if (price.currency !== 'SAR' || price.amountMinor !== 130000n || price.effectiveTo)
      throw new Error('سعر اختبار الاشتراك غير مطابق');
  });
  console.log('كتالوج TEST_SA_MONTHLY جاهز في manzoor_test فقط');
} finally { await db.$disconnect(); }
