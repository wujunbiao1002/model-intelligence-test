export interface LoginCredentials {
  userId: string;
  token: string;
}

const STORAGE_KEY = 'model-intelligence-test-sso-credentials';
let credentials: LoginCredentials | null = null;

export class LoginRequiredError extends Error {
  constructor(message = '登录已失效，请重新登录') {
    super(message);
    this.name = 'LoginRequiredError';
  }
}

export class MissingLoginCredentialsError extends LoginRequiredError {
  constructor() {
    super('未收到登录凭据。请在控制台中通过“鹈鹕测试”入口重新打开本页面。');
    this.name = 'MissingLoginCredentialsError';
  }
}

// Claims only reject unusable input; the profile API verifies identity.
export function validateCredentials(value: LoginCredentials): void {
  try {
    if (!/^[1-9]\d*$/.test(value.userId) || !Number.isSafeInteger(Number(value.userId))) throw new Error();
    const parts = value.token.split('.');
    if (parts.length !== 3 || parts.some((part) => !part)) throw new Error();
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number; nbf?: number };
    if (!Number.isFinite(payload.exp) || Number(payload.exp) * 1000 <= Date.now()) {
      throw new LoginRequiredError();
    }
    if (payload.nbf !== undefined && (!Number.isFinite(payload.nbf) || payload.nbf * 1000 > Date.now())) {
      throw new LoginRequiredError('登录凭据尚未生效，请检查系统时间或重新登录');
    }
  } catch (error) {
    if (error instanceof LoginRequiredError) throw error;
    throw new LoginRequiredError('登录参数无效，请从控制台重新进入');
  }
}

export function storeCredentials(value: LoginCredentials): void {
  credentials = value;
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Memory-only when storage is unavailable. */ }
}

export function readCredentials(): LoginCredentials | null {
  if (typeof window === 'undefined') return null;
  if (credentials) return credentials;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as LoginCredentials;
    if (typeof value.userId !== 'string' || typeof value.token !== 'string') return null;
    credentials = value;
    return value;
  } catch { return null; }
}

export function clearAuthToken(): void {
  credentials = null;
  try { window.sessionStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}

export function takeUrlCredentials(): LoginCredentials | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('token') && !url.searchParams.has('user_id')) return null;
  const value = { userId: url.searchParams.get('user_id') || '', token: url.searchParams.get('token') || '' };
  url.searchParams.delete('token');
  url.searchParams.delete('user_id');
  window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
  // Never fall back to a previous account when a new login link is invalid.
  clearAuthToken();
  validateCredentials(value);
  storeCredentials(value);
  return value;
}

// Served from the same origin as sub2api.
export const LOGIN_URL = '/login';
export const DASHBOARD_URL = '/dashboard';
