import { NextRequest, NextResponse } from 'next/server';

export const AUTH_COOKIE_NAME = 'kvideo_auth';
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days
const NON_PERSIST_TOKEN_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const PERSIST_TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

type Role = 'super_admin' | 'admin' | 'viewer';

export interface AuthCookiePayload {
    profileId: string;
    name: string;
    role: Role;
    customPermissions?: string[];
    exp: number;
}

function getAuthSecret(): string {
    const customSecret = process.env.AUTH_COOKIE_SECRET?.trim();
    if (customSecret) {
        return customSecret;
    }

    return `${process.env.ADMIN_PASSWORD || ''}|${process.env.ACCESS_PASSWORD || ''}|${process.env.ACCOUNTS || ''}|kvideo-auth-cookie-v1`;
}

export function isAuthEnabled(): boolean {
    return !!(process.env.ADMIN_PASSWORD || process.env.ACCESS_PASSWORD || process.env.ACCOUNTS);
}

function bytesToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((b) => {
        binary += String.fromCharCode(b);
    });

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
}

function constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

async function sha256Hex(input: string): Promise<string> {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hash));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function signPayload(encodedPayload: string): Promise<string> {
    return sha256Hex(`${encodedPayload}.${getAuthSecret()}`);
}

export async function createAuthToken(
    payload: Omit<AuthCookiePayload, 'exp'>,
    persistSession: boolean
): Promise<string> {
    const exp = Date.now() + (persistSession ? PERSIST_TOKEN_TTL_MS : NON_PERSIST_TOKEN_TTL_MS);
    const fullPayload: AuthCookiePayload = { ...payload, exp };
    const payloadBytes = new TextEncoder().encode(JSON.stringify(fullPayload));
    const encodedPayload = bytesToBase64Url(payloadBytes);
    const signature = await signPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

function isValidRole(role: unknown): role is Role {
    return role === 'super_admin' || role === 'admin' || role === 'viewer';
}

export async function verifyAuthToken(token?: string | null): Promise<AuthCookiePayload | null> {
    if (!token) return null;

    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return null;

    const expectedSignature = await signPayload(encodedPayload);
    if (!constantTimeEquals(signature, expectedSignature)) {
        return null;
    }

    try {
        const bytes = base64UrlToBytes(encodedPayload);
        const json = new TextDecoder().decode(bytes);
        const parsed = JSON.parse(json) as AuthCookiePayload;

        if (
            typeof parsed.profileId !== 'string' ||
            typeof parsed.name !== 'string' ||
            !isValidRole(parsed.role) ||
            typeof parsed.exp !== 'number'
        ) {
            return null;
        }

        if (parsed.exp <= Date.now()) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}

export function getAuthTokenFromRequest(request: NextRequest): string | null {
    const cookieToken = request.cookies.get(AUTH_COOKIE_NAME)?.value;
    if (cookieToken) return cookieToken;

    const authHeader = request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
        return authHeader.slice(7).trim();
    }

    return null;
}

export function setAuthCookie(response: NextResponse, token: string, persistSession: boolean): void {
    response.cookies.set({
        name: AUTH_COOKIE_NAME,
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        ...(persistSession ? { maxAge: COOKIE_MAX_AGE_SECONDS } : {}),
    });
}

export function clearAuthCookie(response: NextResponse): void {
    response.cookies.set({
        name: AUTH_COOKIE_NAME,
        value: '',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
    });
}
