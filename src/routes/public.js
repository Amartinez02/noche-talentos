import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import QRCode from 'qrcode'
import { db } from '../db.js'

const __dirname   = path.dirname(fileURLToPath(import.meta.url))
const TRANSFER_DIR = path.join(__dirname, '../../static/uploads/transfers')
const BASE_URL    = () => process.env.BASE_URL || 'http://localhost:8080'

const ALLOWED_IMG = new Set(['image/jpeg', 'image/png', 'image/webp'])

export async function publicRoutes(fastify) {
  fastify.get('/', async (req, reply) => {
    const participants = await db.listParticipants({ activeOnly: true })
    return reply.view('index.njk', { participants })
  })

  fastify.get('/purchase', async (req, reply) => {
    const ministries = await db.listMinistries({ activeOnly: true })
    return reply.view('purchase.njk', { error: null, ministries })
  })

  fastify.post('/purchase', async (req, reply) => {
    const ministries = await db.listMinistries({ activeOnly: true })
    const fields = {}
    let transferProofPath = null

    try {
      const parts = req.parts()
      for await (const part of parts) {
        if (part.type === 'field') {
          fields[part.fieldname] = part.value
        } else if (part.fieldname === 'transfer_proof' && part.filename) {
          if (!ALLOWED_IMG.has(part.mimetype)) {
            part.file.resume()
            return reply.view('purchase.njk', {
              error: 'Solo se permiten imágenes JPG, PNG o WebP como comprobante.',
              ministries
            })
          }
          const ext  = path.extname(part.filename) || '.jpg'
          const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`
          transferProofPath = path.join(TRANSFER_DIR, name)
          await pipeline(part.file, fs.createWriteStream(transferProofPath))

          const stat = fs.statSync(transferProofPath)
          if (stat.size > 6 * 1024 * 1024) {
            fs.unlink(transferProofPath, () => {})
            transferProofPath = null
            return reply.view('purchase.njk', {
              error: 'La imagen del comprobante no puede superar 6 MB.',
              ministries
            })
          }
        } else {
          part.file?.resume()
        }
      }
    } catch {
      return reply.view('purchase.njk', { error: 'Error al procesar el formulario.', ministries })
    }

    const { name, phone, email, ministry_id } = fields
    const n = name?.trim(), p = phone?.trim(), e = email?.trim()
    if (!n || !p || !e) {
      if (transferProofPath) fs.unlink(transferProofPath, () => {})
      return reply.view('purchase.njk', { error: 'Todos los campos son requeridos.', ministries })
    }

    const proofRelPath = transferProofPath
      ? `/uploads/transfers/${path.basename(transferProofPath)}`
      : null

    const ticket = await db.createTicket(n, p, e, ministry_id || null, proofRelPath)
    return reply.redirect(`/ticket/${ticket.id}`)
  })

  fastify.get('/ticket/:id', async (req, reply) => {
    const ticket = await db.getTicket(req.params.id)
    if (!ticket) return reply.code(404).send('Boleta no encontrada')

    const qrData = `${BASE_URL()}/ticket/${ticket.id}`
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

  fastify.get('/ticket/:id/qr', async (req, reply) => {
    const ticket = await db.getTicket(req.params.id)
    if (!ticket) return reply.code(404).send('Not found')

    const buffer = await QRCode.toBuffer(`${BASE_URL()}/ticket/${ticket.id}`, {
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
