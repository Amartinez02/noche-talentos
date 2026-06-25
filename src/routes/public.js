import QRCode from 'qrcode'
import { db } from '../db.js'

const BASE_URL = () => process.env.BASE_URL || 'http://localhost:8080'

export async function publicRoutes(fastify) {
  fastify.get('/', async (req, reply) => {
    const participants = await db.listParticipants({ activeOnly: true })
    return reply.view('index.njk', { participants })
  })

  fastify.get('/comprar', async (req, reply) => {
    const ministries = await db.listMinistries({ activeOnly: true })
    return reply.view('purchase.njk', { error: null, ministries })
  })

  fastify.post('/comprar', async (req, reply) => {
    const { name, phone, email, ministry_id } = req.body || {}
    const n = name?.trim(), p = phone?.trim(), e = email?.trim()
    const ministries = await db.listMinistries({ activeOnly: true })
    if (!n || !p || !e) return reply.view('purchase.njk', { error: 'Todos los campos son requeridos.', ministries })
    const ticket = await db.createTicket(n, p, e, ministry_id || null)
    return reply.redirect(`/boleta/${ticket.id}`)
  })

  fastify.get('/boleta/:id', async (req, reply) => {
    const ticket = await db.getTicket(req.params.id)
    if (!ticket) return reply.code(404).send('Boleta no encontrada')

    const qrData = `${BASE_URL()}/boleta/${ticket.id}`
    const qrDataURL = await QRCode.toDataURL(qrData, {
      errorCorrectionLevel: 'H', width: 300,
      color: { dark: '#7B1717', light: '#F5EDD8' }
    })

    return reply.view('ticket.njk', {
      ticket, qrDataURL,
      createdAt:   formatDate(ticket.created_at),
      validatedAt: formatDate(ticket.validated_at),
      paidAt:      formatDate(ticket.paid_at)
    })
  })

  fastify.get('/boleta/:id/qr', async (req, reply) => {
    const ticket = await db.getTicket(req.params.id)
    if (!ticket) return reply.code(404).send('Not found')

    const buffer = await QRCode.toBuffer(`${BASE_URL()}/boleta/${ticket.id}`, {
      errorCorrectionLevel: 'H', width: 400,
      color: { dark: '#7B1717', light: '#F5EDD8' }
    })
    reply.header('Content-Type', 'image/png')
    reply.header('Content-Disposition', `attachment; filename="boleta-${ticket.id}.png"`)
    return reply.send(buffer)
  })
}

function formatDate(d) {
  if (!d) return null
  return new Date(d).toLocaleString('es-DO', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}
