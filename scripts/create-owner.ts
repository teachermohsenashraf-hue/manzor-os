import 'dotenv/config';
import { db } from '../src/lib/db';
import { generateTemporaryPassword, hashPassword } from '../src/lib/password';
import { usernameSchema } from '../src/lib/validation';
async function main(){
  const username=usernameSchema.parse(process.env.OWNER_USERNAME);
  const name=process.env.OWNER_NAME?.trim();
  if(!name||name.length<2) throw new Error('Set OWNER_NAME and OWNER_USERNAME in this shell session.');
  const password=generateTemporaryPassword();
  const passwordHash=await hashPassword(password);
  await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(94720517)`;
    if(await tx.user.count({where:{role:'OWNER'}})) throw new Error('Owner already exists. No changes made.');
    const user=await tx.user.create({data:{name,username,passwordHash,role:'OWNER'}});
    await tx.auditLog.create({data:{actorId:user.id,action:'OWNER_CREATED',subjectId:user.id,detail:{username}}});
  });
  // This is the only time the bootstrap credential is shown to the operator.
  process.stdout.write(`Owner created: ${username}\nTemporary password (save securely): ${password}\nChange required at first login.\n`);
}
main().catch(()=>{console.error('Owner creation failed. Check configuration and whether an owner already exists.');process.exitCode=1;}).finally(()=>db.$disconnect());
