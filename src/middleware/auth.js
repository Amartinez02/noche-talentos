import crypto from 'crypto'
import { db } from '../db.js'

const COOKIE_NAME = 'admin_session'
const SESSION_SECRET = () => process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || 'dev-secret'

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err)
      else resolve(derivedKey.toString('hex'))
    })
  })
  return `${salt}:${hash}`
}

export async function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':')
    const derived = await new Promise((resolve, reject) => {
      crypto.scrypt(password, salt, 64, (err, dk) => {
        if (err) reject(err)
        else resolve(dk)
      })
    })
    return crypto.timingSafeEqual(derived, Buffer.from(hash, 'hex'))
  } catch {
    return false
  }
}

function signToken(username) {
  const sig = crypto
    .createHmac('sha256', SESSION_SECRET())
    .update(username)
    .digest('hex')
  return `${username}:${sig}`
}

function parseToken(token) {
  try {
    if (!token || token.length < 65) return null
    const sig = token.slice(-64)
    const username = token.slice(0, -(64 + 1)) // strip trailing ':' + 64 hex chars
    const expected = crypto
      .createHmac('sha256', SESSION_SECRET())
      .update(username)
      .digest('hex')
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null
    return username
  } catch {
    return null
  }
}

export function setSession(reply, username) {
  reply.setCookie(COOKIE_NAME, signToken(username), {
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
  const username = parseToken(cookie)
  if (!username) return reply.redirect('/admin/login')
  const user = await db.getUserByUsername(username)
  if (!user) return reply.redirect('/admin/login')
  request.adminUser = user
}

export function getSessionUsername(request) {
  const cookie = request.cookies?.[COOKIE_NAME]
  return parseToken(cookie)
}
