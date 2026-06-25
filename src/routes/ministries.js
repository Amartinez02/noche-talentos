import { db } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'

export async function ministryRoutes(fastify) {
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/admin/ministerios')) await requireAdmin(req, reply)
  })

  fastify.get('/admin/ministerios', async (req, reply) => {
    const ministries = await db.listMinistries()
    return reply.view('admin/ministries.njk', { ministries })
  })

  fastify.post('/admin/ministerios', async (req, reply) => {
    const { name } = req.body || {}
    if (name?.trim()) await db.createMinistry(name)
    return reply.redirect('/admin/ministerios')
  })

  fastify.post('/admin/ministerios/reordenar', async (req, reply) => {
    const { ids } = req.body || {}
    if (!Array.isArray(ids)) return reply.code(400).send({ status: 'error' })
    await db.reorderMinistries(ids)
    return reply.send({ status: 'ok' })
  })

  fastify.post('/admin/ministerios/:id', async (req, reply) => {
    const { name } = req.body || {}
    if (!name?.trim()) return reply.code(400).send({ status: 'error', message: 'Nombre requerido' })
    const updated = await db.updateMinistry(req.params.id, name)
    if (!updated) return reply.code(404).send({ status: 'error' })
    return reply.send({ status: 'ok', ministry: updated })
  })

  fastify.post('/admin/ministerios/:id/eliminar', async (req, reply) => {
    await db.deleteMinistry(req.params.id)
    return reply.redirect('/admin/ministerios')
  })

  fastify.post('/admin/ministerios/:id/toggle', async (req, reply) => {
    await db.toggleMinistry(req.params.id)
    return reply.redirect('/admin/ministerios')
  })
}
