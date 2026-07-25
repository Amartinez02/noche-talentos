import crypto from 'crypto'
import { db } from '../db.js'
import { setSession, clearSession, requireAdmin, getSessionUsername, hashPassword, verifyPassword } from '../middleware/auth.js'

function formatDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export async function adminRoutes(fastify) {
  fastify.get('/admin', async (req, reply) => reply.redirect('/admin/login'))

  fastify.get('/admin/login', async (req, reply) => reply.view('admin/login.njk', { error: null }))

  fastify.post('/admin/login', async (req, reply) => {
    const { username, password } = req.body || {}
    if (!username || !password) return reply.view('admin/login.njk', { error: 'Usuario y contraseña requeridos.' })
    const user = await db.getUserByUsername(username.trim().toLowerCase())
    if (!user) return reply.view('admin/login.njk', { error: 'Usuario o contraseña incorrectos.' })
    const valid = await verifyPassword(password, user.password_hash)
    if (!valid) return reply.view('admin/login.njk', { error: 'Usuario o contraseña incorrectos.' })
    setSession(reply, user.username)
    return reply.redirect('/admin/dashboard')
  })

  fastify.post('/admin/logout', async (req, reply) => {
    clearSession(reply)
    return reply.redirect('/admin/login')
  })

  // ─── API JSON para el escáner (requiere auth de admin) ───────────────────
  fastify.post('/api/validate/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return

    const { id } = req.params
    const updated = await db.validateTicket(id)
    if (updated) {
      return reply.send({ status: 'ok', message: '¡Boleta válida!', name: updated.name, is_paid: updated.is_paid })
    }
    const existing = await db.getTicket(id)
    if (!existing) return reply.code(404).send({ status: 'error', message: 'Boleta no encontrada.' })
    if (existing.validated_at) {
      return reply.send({ status: 'already_used', message: 'Ya fue validada.', name: existing.name, is_paid: existing.is_paid, validated_at: existing.validated_at })
    }
    return reply.code(400).send({ status: 'error', message: 'Boleta inválida.' })
  })

  // ─── API JSON para marcar como pagada ────────────────────────────────────
  fastify.post('/api/pay/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return

    const ticket = await db.markPaid(req.params.id)
    if (!ticket) return reply.code(404).send({ status: 'error', message: 'Boleta no encontrada o ya marcada como pagada.' })
    return reply.send({ status: 'ok', message: 'Boleta marcada como pagada.', ticket })
  })

  fastify.post('/api/unpay/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return

    const ticket = await db.markUnpaid(req.params.id)
    if (!ticket) return reply.code(404).send({ status: 'error', message: 'No se pudo actualizar.' })
    return reply.send({ status: 'ok', ticket })
  })

  fastify.post('/api/toggle-child/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return

    const ticket = await db.toggleChild(req.params.id)
    if (!ticket) return reply.code(404).send({ status: 'error', message: 'Boleta no encontrada.' })
    return reply.send({ status: 'ok', ticket })
  })

  fastify.post('/api/update-counts/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return
    const adult_count = Math.max(0, parseInt(req.body.adult_count) || 0)
    const child_count = Math.max(0, parseInt(req.body.child_count) || 0)
    if (adult_count + child_count < 1) return reply.code(400).send({ status: 'error', message: 'Al menos 1 persona requerida.' })
    const ticket = await db.updateCounts(req.params.id, adult_count, child_count)
    if (!ticket) return reply.code(404).send({ status: 'error', message: 'Boleta no encontrada.' })
    return reply.send({ status: 'ok', ticket })
  })

  fastify.delete('/api/ticket/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return

    const deleted = await db.deleteTicket(req.params.id)
    if (!deleted) return reply.code(404).send({ status: 'error', message: 'Boleta no encontrada.' })
    return reply.send({ status: 'ok' })
  })

  // ─── Rutas protegidas del panel ───────────────────────────────────────────
  fastify.addHook('onRequest', async (req, reply) => {
    const protectedPaths = ['/admin/dashboard', '/admin/tickets', '/admin/scanner', '/admin/validacion', '/admin/users', '/admin/participants', '/admin/ministries']
    if (protectedPaths.some(p => req.url.startsWith(p))) {
      await requireAdmin(req, reply)
    }
  })

  fastify.get('/admin/dashboard', async (req, reply) => {
    const stats = await db.stats()
    const adults   = parseInt(stats.adults || 0)
    const children = parseInt(stats.children || 0)
    return reply.view('admin/dashboard.njk', {
      total:            parseInt(stats.total),
      validated:        parseInt(stats.validated),
      pending:          parseInt(stats.pending),
      paid:             parseInt(stats.paid),
      unpaid:           parseInt(stats.total) - parseInt(stats.paid),
      adults,
      children,
      adults_revenue:   adults * 300,
      children_revenue: children * 100,
      revenue:          parseInt(stats.revenue || 0)
    })
  })

  fastify.get('/admin/tickets', async (req, reply) => {
    const { search = '', page: pageStr = '1' } = req.query
    const page = Math.max(1, parseInt(pageStr) || 1)
    const limit = 25

    const [{ rows: tickets, total: ticketsTotal }, stats] = await Promise.all([
      db.listTickets({ search: search.trim() || null, page, limit }),
      db.stats()
    ])

    const totalPages = Math.max(1, Math.ceil(ticketsTotal / limit))
    const safePage = Math.min(page, totalPages)

    const formatted = tickets.map(t => ({
      ...t,
      created_fmt:   formatDate(t.created_at),
      validated_fmt: formatDate(t.validated_at),
      paid_fmt:      formatDate(t.paid_at)
    }))

    return reply.view('admin/tickets.njk', {
      tickets: formatted,
      total:     parseInt(stats.total),
      validated: parseInt(stats.validated),
      pending:   parseInt(stats.pending),
      paid:      parseInt(stats.paid),
      children:         parseInt(stats.children || 0),
      adults:           parseInt(stats.adults || 0),
      adults_revenue:   parseInt(stats.adults || 0) * 300,
      children_revenue: parseInt(stats.children || 0) * 100,
      revenue:          parseInt(stats.revenue || 0),
      unpaid:    parseInt(stats.total) - parseInt(stats.paid),
      search:     search.trim(),
      page:       safePage,
      totalPages,
      ticketsTotal,
      hasPrev:  safePage > 1,
      hasNext:  safePage < totalPages,
      prevPage: safePage - 1,
      nextPage: safePage + 1
    })
  })

  fastify.get('/admin/scanner', async (req, reply) => reply.view('admin/scanner.njk'))

  fastify.get('/admin/validacion', async (req, reply) => reply.view('admin/validacion.njk'))

  fastify.post('/api/lookup', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return
    const { phone } = req.body || {}
    const q = phone?.trim()
    if (!q) return reply.code(400).send({ status: 'error', message: 'Ingresá un nombre o teléfono.' })
    const tickets = await db.findTicketsByNameOrPhone(q)
    if (!tickets.length) return reply.code(404).send({ status: 'not_found', message: 'No se encontró ninguna boleta.' })
    return reply.send({ status: 'ok', tickets })
  })

  fastify.post('/api/validate-pay/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return
    const ticket = await db.validateAndPay(req.params.id)
    if (!ticket) return reply.code(404).send({ status: 'error', message: 'Boleta no encontrada.' })
    return reply.send({ status: 'ok', ticket })
  })

  // ─── Users management ────────────────────────────────────────────────────
  fastify.get('/admin/users', async (req, reply) => {
    const users = await db.listUsers()
    const currentUser = getSessionUsername(req)
    const formatted = users.map(u => ({
      ...u,
      created_fmt: formatDate(u.created_at),
      pending: !!u.invite_token
    }))
    const viewData = { users: formatted, currentUser }
    if (req.query.invite && req.query.for) {
      viewData.inviteLink = `${req.protocol}://${req.headers.host}/invite/${req.query.invite}`
      viewData.inviteFor = req.query.for
    }
    return reply.view('admin/users.njk', viewData)
  })

  fastify.post('/admin/users/create', async (req, reply) => {
    const { username } = req.body || {}

    const usernameClean = (username || '').trim().toLowerCase()
    if (!/^[a-z0-9_-]{3,50}$/.test(usernameClean)) {
      const users = await db.listUsers()
      const currentUser = getSessionUsername(req)
      const formatted = users.map(u => ({ ...u, created_fmt: formatDate(u.created_at), pending: !!u.invite_token }))
      return reply.view('admin/users.njk', { users: formatted, currentUser, createError: 'El usuario debe tener entre 3 y 50 caracteres (letras, números, guiones).' })
    }

    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000)

    try {
      await db.createInviteUser(usernameClean, token, expires)
    } catch (err) {
      if (err.code === '23505') {
        const users = await db.listUsers()
        const currentUser = getSessionUsername(req)
        const formatted = users.map(u => ({ ...u, created_fmt: formatDate(u.created_at), pending: !!u.invite_token }))
        return reply.view('admin/users.njk', { users: formatted, currentUser, createError: 'Ese nombre de usuario ya existe.' })
      }
      throw err
    }
    return reply.redirect(`/admin/users?invite=${token}&for=${encodeURIComponent(usernameClean)}`)
  })

  fastify.post('/admin/users/:id/regenerate-invite', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return
    const { id } = req.params
    const token = crypto.randomBytes(32).toString('hex')
    const expires = new Date(Date.now() + 72 * 60 * 60 * 1000)
    const user = await db.regenerateInvite(parseInt(id), token, expires)
    if (!user) return reply.redirect('/admin/users')
    return reply.redirect(`/admin/users?invite=${token}&for=${encodeURIComponent(user.username)}`)
  })

  fastify.post('/admin/users/:id/change-password', async (req, reply) => {
    const { new_password, confirm_password } = req.body || {}
    const { id } = req.params

    if (!new_password || new_password.length < 6) {
      return reply.redirect('/admin/users?pwError=short')
    }
    if (new_password !== confirm_password) {
      return reply.redirect('/admin/users?pwError=mismatch')
    }

    const hash = await hashPassword(new_password)
    const updated = await db.changePassword(parseInt(id), hash)
    if (!updated) return reply.redirect('/admin/users?pwError=notfound')
    return reply.redirect('/admin/users?changed=1')
  })

  fastify.post('/admin/users/:id/delete', async (req, reply) => {
    const { id } = req.params
    const count = await db.countUsers()
    if (count <= 1) return reply.redirect('/admin/users?deleteError=last')
    await db.deleteUser(parseInt(id))
    return reply.redirect('/admin/users')
  })

  // ─── Public invite routes (no auth required) ─────────────────────────────
  fastify.get('/invite/:token', async (req, reply) => {
    const { token } = req.params
    const user = await db.getUserByInviteToken(token)
    if (!user) return reply.view('admin/invite.njk', { expired: true })
    return reply.view('admin/invite.njk', { expired: false, user: { username: user.username }, token })
  })

  fastify.post('/invite/:token', async (req, reply) => {
    const { token } = req.params
    const user = await db.getUserByInviteToken(token)
    if (!user) return reply.view('admin/invite.njk', { expired: true })

    const { password, confirm_password } = req.body || {}
    if (!password || password.length < 6) {
      return reply.view('admin/invite.njk', { expired: false, user: { username: user.username }, token, error: 'La contraseña debe tener al menos 6 caracteres.' })
    }
    if (password !== confirm_password) {
      return reply.view('admin/invite.njk', { expired: false, user: { username: user.username }, token, error: 'Las contraseñas no coinciden.' })
    }

    const hash = await hashPassword(password)
    await db.activateUser(user.id, hash)
    setSession(reply, user.username)
    return reply.redirect('/admin/dashboard')
  })
}
