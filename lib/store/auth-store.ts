/**
 * Auth Store - Simple module-level session management
 * NOT Zustand — needs to be synchronous at import time for store key generation
 */

export type Role = 'super_admin' | 'admin' | 'viewer';

export type Permission =
  | 'source_management'
  | 'account_management'
  | 'danmaku_api'
  | 'data_management'
  | 'player_settings'
  | 'danmaku_appearance'
  | 'view_settings'
  | 'iptv_access';

const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  super_admin: ['source_management', 'account_management', 'danmaku_api', 'data_management', 'player_settings', 'danmaku_appearance', 'view_settings', 'iptv_access'],
  admin: ['player_settings', 'danmaku_appearance', 'view_settings', 'iptv_access'],
  viewer: ['view_settings'],
};

export interface AuthSession {
  profileId: string;
  name: string;
  role: Role;
  customPermissions?: Permission[];
}

const SESSION_KEY = 'kvideo-session';

export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  // Check sessionStorage first, then localStorage (for persisted sessions)
  const raw = sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.profileId && parsed.name && parsed.role) {
      return parsed as AuthSession;
    }
  } catch {
    // Invalid session data
  }
  return null;
}

export function setSession(session: AuthSession, persist: boolean): void {
  if (typeof window === 'undefined') return;
  const data = JSON.stringify(session);
  sessionStorage.setItem(SESSION_KEY, data);
  if (persist) {
    localStorage.setItem(SESSION_KEY, data);
  }
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(SESSION_KEY);
  // Clear search cache so new session gets fresh results
  localStorage.removeItem('kvideo_search_cache');
  // Also clear old unlock keys for backward compat cleanup
  sessionStorage.removeItem('kvideo-unlocked');
  localStorage.removeItem('kvideo-unlocked');

  // Clear server-side auth cookie as well.
  void fetch('/api/auth', {
    method: 'DELETE',
    credentials: 'include',
    keepalive: true,
  }).catch(() => {
    // Ignore network errors during logout cleanup.
  });
}

export function isAdmin(): boolean {
  const session = getSession();
  if (!session) return true; // No auth configured = full access
  return session.role === 'admin' || session.role === 'super_admin';
}

export function hasPermission(permission: Permission): boolean {
  const session = getSession();
  if (!session) return true; // No auth configured = full access
  if (ROLE_PERMISSIONS[session.role]?.includes(permission)) return true;
  if (session.customPermissions?.includes(permission)) return true;
  return false;
}

export function hasRole(minimumRole: Role): boolean {
  const session = getSession();
  if (!session) return true; // No auth configured = full access
  const hierarchy: Role[] = ['viewer', 'admin', 'super_admin'];
  return hierarchy.indexOf(session.role) >= hierarchy.indexOf(minimumRole);
}

export function getProfileId(): string {
  const session = getSession();
  return session?.profileId || '';
}
