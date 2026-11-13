export type UserRole = 'customer' | 'agent' | 'admin';

/** Decoded access-token payload, attached to `req.user` by JwtAuthGuard. */
export interface AuthUser {
  /** users.id for customer/agent, admins.id for admin. */
  sub: string;
  role: UserRole;
  phone?: string;
  email?: string;
  customerId?: string;
  agentId?: string;
  adminId?: string;
  appCode?: 'SZOOP' | 'AIRA';
}

export interface AuthenticatedRequest {
  user: AuthUser;
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}
