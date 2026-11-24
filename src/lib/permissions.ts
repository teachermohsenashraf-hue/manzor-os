export const roleLabels = { OWNER: 'مالك النظام', MANAGER: 'مشرف', COMMUNICATION: 'مسؤول التواصل', EXECUTION: 'مسؤول التنفيذ' } as const;
export type UserRole = keyof typeof roleLabels;
export type Permission = 'users:manage' | 'audit:read' | 'finance:read' | 'settings:manage';
export function can(role: UserRole, permission: Permission): boolean {
  // No implicit manager access; extra scoped grants will be added with their modules.
  return role === 'OWNER' && ['users:manage', 'audit:read', 'finance:read', 'settings:manage'].includes(permission);
}
