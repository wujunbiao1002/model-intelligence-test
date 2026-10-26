import type { Sub2ApiKeyOption, Sub2ApiModelOption, Sub2ApiUser } from '@/types';
import { clearAuthToken, LoginRequiredError, MissingLoginCredentialsError, readCredentials, takeUrlCredentials, validateCredentials } from '@/lib/url-auth';
import type { LoginCredentials } from '@/lib/url-auth';

export interface Sub2ApiSession {
  authenticated: boolean;
  user?: Sub2ApiUser;
  keys?: Sub2ApiKeyOption[];
}

export const AUTH_INVALIDATED = 'model-intelligence-test-auth-invalidated';
let verifiedSession: Sub2ApiSession | null = null;
let initialization: Promise<Sub2ApiSession> | null = null;
let sessionController = new AbortController();

export function getSub2ApiAbortSignal(): AbortSignal { return sessionController.signal; }

export function invalidateSub2ApiSession(): void {
  sessionController.abort();
  sessionController = new AbortController();
  verifiedSession = null;
  initialization = null;
  clearAuthToken();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_INVALIDATED));
}

async function requestJson<T>(path: string, token: string, loginToken = true): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error('无法连接服务（' + path.split('?')[0] + '），请检查网络后重试');
  }
  if (response.status === 401 && loginToken) {
    if (readCredentials()?.token === token) invalidateSub2ApiSession();
    throw new LoginRequiredError();
  }
  if (!response.ok) {
    if (response.status === 403) throw new Error('当前账号或 API Key 没有访问权限（HTTP 403）');
    if (response.status === 401) throw new Error('所选 API Key 已失效，请更换 Key');
    throw new Error('服务请求失败（HTTP ' + response.status + '，' + path.split('?')[0] + '）');
  }
  try { return await response.json() as T; } catch {
    throw new Error('接口未返回有效 JSON（' + path.split('?')[0] + '），请检查部署路由');
  }
}

function assertCurrent(value: LoginCredentials): void {
  if (readCredentials()?.token !== value.token || readCredentials()?.userId !== value.userId) {
    throw new LoginRequiredError('登录用户已变更，请刷新页面');
  }
  try { validateCredentials(value); } catch (error) {
    invalidateSub2ApiSession();
    throw error;
  }
}

interface KeyRecord { id: number; name?: string; key?: string; status?: string; user_id?: number; group?: { name?: string } }

export async function getSub2ApiSession(): Promise<Sub2ApiSession> {
  const value = readCredentials();
  if (!value) throw new MissingLoginCredentialsError();
  assertCurrent(value);
  verifiedSession = null;
  const profile = await requestJson<{ data?: Sub2ApiUser } & Partial<Sub2ApiUser>>('/api/v1/user/profile', value.token);
  assertCurrent(value);
  const user = profile.data || profile;
  if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0) throw new Error('用户接口未返回有效身份信息');
  if (String(user.id) !== value.userId) {
    invalidateSub2ApiSession();
    throw new LoginRequiredError('登录身份不匹配，请从控制台重新进入');
  }

  const keys: Sub2ApiKeyOption[] = [];
  for (let page = 1; ; page++) {
    const payload = await requestJson<{ data?: KeyRecord[] | { items?: KeyRecord[]; total?: number } }>('/api/v1/keys?page=' + page + '&page_size=100', value.token);
    assertCurrent(value);
    const raw = Array.isArray(payload.data) ? payload.data : payload.data?.items;
    if (!Array.isArray(raw)) throw new Error('Key 列表接口返回格式不正确');
    for (const key of raw) {
      if (key.status && key.status !== 'active') continue;
      if (!Number.isSafeInteger(key.id) || key.id <= 0) continue;
      if (key.user_id !== undefined && key.user_id !== user.id) continue;
      keys.push({ id: key.id, name: key.name || 'API Key ' + key.id,
        maskedKey: key.key && key.key.length > 8 ? key.key.slice(0, 4) + '****' + key.key.slice(-4) : '********',
        groupName: key.group?.name });
    }
    if (Array.isArray(payload.data) || raw.length < 100 ||
      (typeof payload.data?.total === 'number' && page * 100 >= payload.data.total)) break;
    if (page >= 100) throw new Error('Key 列表分页异常，请联系管理员');
  }
  verifiedSession = { authenticated: true, user: user as Sub2ApiUser, keys };
  return verifiedSession;
}

export function initializeSub2ApiSession(): Promise<Sub2ApiSession> {
  if (!initialization) {
    initialization = Promise.resolve().then(() => {
      takeUrlCredentials();
      return getSub2ApiSession();
    }).catch((error: unknown) => {
      initialization = null;
      throw error;
    });
  }
  return initialization;
}

export async function getSub2ApiKey(keyId: number, userId?: number): Promise<string> {
  const value = readCredentials();
  if (!value || !verifiedSession?.authenticated) throw new LoginRequiredError();
  assertCurrent(value);
  if (userId !== undefined && verifiedSession.user?.id !== userId) throw new LoginRequiredError('登录用户已变更，请刷新页面');
  if (!verifiedSession.keys?.some((key) => key.id === keyId)) throw new Error('请选择当前账号的有效 API Key');
  const payload = await requestJson<{ data?: KeyRecord }>('/api/v1/keys/' + encodeURIComponent(keyId), value.token);
  assertCurrent(value);
  const key = payload.data;
  if (!key?.key || (key.status && key.status !== 'active')) throw new Error('所选 API Key 不可用，请重新选择');
  if ((key.id !== undefined && key.id !== keyId) || (key.user_id !== undefined && String(key.user_id) !== value.userId)) {
    throw new Error('API Key 与当前用户不匹配');
  }
  return key.key;
}

export async function getSub2ApiModels(keyId: number): Promise<Sub2ApiModelOption[]> {
  const value = readCredentials();
  const key = await getSub2ApiKey(keyId);
  const result = await requestJson<{ data?: Sub2ApiModelOption[] }>('/v1/models', key, false);
  if (!value) throw new LoginRequiredError();
  assertCurrent(value);
  if (!Array.isArray(result.data)) throw new Error('模型接口返回格式不正确');
  return result.data;
}
