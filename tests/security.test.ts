import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTemporaryPassword, hashPassword, verifyPassword } from '../src/lib/password';
import { can, type UserRole } from '../src/lib/permissions';
import { userSchema, usernameSchema, passwordSchema } from '../src/lib/validation';
test('passwords are salted and never stored as plaintext',async()=>{
  const password='a sufficiently long secret';
  const a=await hashPassword(password),b=await hashPassword(password);
  assert.notEqual(a,b);assert.ok(!a.includes(password));assert.equal(await verifyPassword(password,a),true);assert.equal(await verifyPassword('wrong password',a),false);
});
test('malformed password hash fails closed',async()=>{assert.equal(await verifyPassword('secret','broken'),false);assert.equal(await verifyPassword('secret','scrypt-v1:x:y'),false);});
for(const role of ['MANAGER','COMMUNICATION','EXECUTION'] as UserRole[])test(`${role} has no implicit administrative or financial rights`,()=>{for(const permission of ['users:manage','audit:read','finance:read','settings:manage'] as const)assert.equal(can(role,permission),false);});
test('owner can administer users',()=>assert.equal(can('OWNER','users:manage'),true));
test('account creation cannot grant OWNER or inject arbitrary role',()=>{for(const role of ['OWNER','root'])assert.equal(userSchema.safeParse({name:'Test User',username:'test',password:'abcdefghijklmnop',role,contact:''}).success,false);});
test('username normalizes before uniqueness and rejects invalid identifiers',()=>{assert.equal(usernameSchema.parse(' Alice '),'alice');assert.equal(usernameSchema.safeParse('a/b').success,false);});
test('password accepts eight or more English letters and digits',()=>{
  for(const value of ['abcdefgh','12345678','Ab12Cd34'])assert.equal(passwordSchema.safeParse(value).success,true);
  for(const value of ['1234567','abc_defg','abcdefgh!','a'.repeat(129)])assert.equal(passwordSchema.safeParse(value).success,false);
  assert.match(generateTemporaryPassword(),/^[A-Za-z0-9]{8}$/);
});
