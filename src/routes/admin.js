import { db } from '../db.js'
import { setSession, clearSession, requireAdmin, checkPassword } from '../middleware/auth.js'

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
    const { password } = req.body || {}
    if (!checkPassword(password)) return reply.view('admin/login.njk', { error: 'Contraseña incorrecta.' })
    setSession(reply)
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

  fastify.delete('/api/ticket/:id', async (req, reply) => {
    await requireAdmin(req, reply)
    if (reply.sent) return

    const deleted = await db.deleteTicket(req.params.id)
    if (!deleted) return reply.code(404).send({ status: 'error', message: 'Boleta no encontrada.' })
    return reply.send({ status: 'ok' })
  })

  // ─── Rutas protegidas del panel ───────────────────────────────────────────
  fastify.addHook('onRequest', async (req, reply) => {
    const protectedPaths = ['/admin/dashboard', '/admin/tickets', '/admin/scanner']
    if (protectedPaths.some(p => req.url.startsWith(p))) {
      await requireAdmin(req, reply)
    }
  })

  fastify.get('/admin/dashboard', async (req, reply) => {
    const stats = await db.stats()
    return reply.view('admin/dashboard.njk', {
      total:     parseInt(stats.total),
      validated: parseInt(stats.validated),
      pending:   parseInt(stats.pending),
      paid:      parseInt(stats.paid),
      revenue:   parseInt(stats.revenue)
    })
  })

  fastify.get('/admin/tickets', async (req, reply) => {
    const tickets = await db.listTickets()
    const formatted = tickets.map(t => ({
      ...t,
      created_fmt:   formatDate(t.created_at),
      validated_fmt: formatDate(t.validated_at),
      paid_fmt:      formatDate(t.paid_at)
    }))
    return reply.view('admin/tickets.njk', { tickets: formatted })
  })

  fastify.get('/admin/scanner', async (req, reply) => reply.view('admin/scanner.njk'))
}
