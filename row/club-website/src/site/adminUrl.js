// The ROW admin portal login, opened from every theme's "Admin login" link (same rule as
// components/AdminLoginLink.tsx: NEXT_PUBLIC_ADMIN_LOGIN_URL, else the portal origin + /login).
const portal = (process.env.NEXT_PUBLIC_PORTAL_ORIGIN || '').replace(/\/$/, '')
export const ADMIN_LOGIN_URL = process.env.NEXT_PUBLIC_ADMIN_LOGIN_URL || (portal ? portal + '/login' : '/login')
