import { NextRequest, NextResponse } from 'next/server';
import { getAuthTokenFromRequest, isAuthEnabled, verifyAuthToken } from './lib/server/auth-cookie';

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    if (!pathname.startsWith('/api/')) {
        return NextResponse.next();
    }

    if (!isAuthEnabled()) {
        return NextResponse.next();
    }

    // Let auth endpoint stay public for login/logout and config bootstrap.
    if (pathname === '/api/auth' || pathname === '/api/auth/') {
        return NextResponse.next();
    }

    // Let OPTIONS through to avoid preflight issues.
    if (request.method === 'OPTIONS') {
        return NextResponse.next();
    }

    const token = getAuthTokenFromRequest(request);
    const session = await verifyAuthToken(token);

    if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Account listing is super-admin only.
    if (pathname === '/api/auth/accounts' && session.role !== 'super_admin') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/api/:path*'],
};
