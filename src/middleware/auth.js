const ADMIN_PASSWORD = () => process.env.ADMIN_PASSWORD || 'admin123'
const COOKIE_NAME = 'admin_session'
const token = () => `sess_${ADMIN_PASSWORD()}`

export function setSession(reply) {
  reply.setCookie(COOKIE_NAME, token(), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7
  })
}

export function clearSession(reply) {
  reply.clearCookie(COOKIE_NAME, { path: '/' })
}

export async function requireAdmin(request, reply) {
  const cookie = request.cookies?.[COOKIE_NAME]
  if (cookie !== token()) {
    return reply.redirect('/admin/login')
  }
}

export function checkPassword(pw) {
  return pw === ADMIN_PASSWORD()
}
