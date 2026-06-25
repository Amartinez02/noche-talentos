import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import { fileURLToPath } from 'url'
import { db } from '../db.js'
import { requireAdmin } from '../middleware/auth.js'

const __dirname  = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '../../static/uploads/participants')

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_MB  = 5

export async function participantRoutes(fastify) {

  // Hook de auth en todas las rutas /admin/participantes
  fastify.addHook('onRequest', async (req, reply) => {
    if (req.url.startsWith('/admin/participantes')) await requireAdmin(req, reply)
  })

  /* ── Lista ── */
  fastify.get('/admin/participantes', async (req, reply) => {
    const participants = await db.listParticipants()
    return reply.view('admin/participants.njk', { participants })
  })

  /* ── Formulario nuevo ── */
  fastify.get('/admin/participantes/nuevo', async (req, reply) => {
    return reply.view('admin/participant-form.njk', { p: null, error: null })
  })

  /* ── Crear ── */
  fastify.post('/admin/participantes', { config: { rawBody: false } }, async (req, reply) => {
    const { fields, photoPath, error } = await parseForm(req)
    if (error) return reply.view('admin/participant-form.njk', { p: null, error })

    const { name, role, description, display_order, active } = fields
    if (!name?.trim() || !role?.trim()) {
      if (photoPath) fs.unlink(photoPath, () => {})
      return reply.view('admin/participant-form.njk', { p: null, error: 'Nombre y categoría son requeridos.' })
    }

    await db.createParticipant({
      name: name.trim(), role: role.trim(),
      description: description?.trim() || null,
      photo_path: photoPath ? `/uploads/participants/${path.basename(photoPath)}` : null,
      display_order: parseInt(display_order) || 0,
      active: active === 'on'
    })
    return reply.redirect('/admin/participantes')
  })

  /* ── Formulario editar ── */
  fastify.get('/admin/participantes/:id/editar', async (req, reply) => {
    const p = await db.getParticipant(req.params.id)
    if (!p) return reply.redirect('/admin/participantes')
    return reply.view('admin/participant-form.njk', { p, error: null })
  })

  /* ── Actualizar ── */
  fastify.post('/admin/participantes/:id', async (req, reply) => {
    const { id } = req.params
    const { fields, photoPath, error } = await parseForm(req)
    if (error) {
      const p = await db.getParticipant(id)
      return reply.view('admin/participant-form.njk', { p, error })
    }

    const { name, role, description, display_order, active } = fields
    if (!name?.trim() || !role?.trim()) {
      if (photoPath) fs.unlink(photoPath, () => {})
      const p = await db.getParticipant(id)
      return reply.view('admin/participant-form.njk', { p, error: 'Nombre y categoría son requeridos.' })
    }

    await db.updateParticipant(id, {
      name: name.trim(), role: role.trim(),
      description: description?.trim() || null,
      photo_path: photoPath ? `/uploads/participants/${path.basename(photoPath)}` : null,
      display_order: parseInt(display_order) || 0,
      active: active === 'on'
    })
    return reply.redirect('/admin/participantes')
  })

  /* ── Eliminar ── */
  fastify.post('/admin/participantes/:id/eliminar', async (req, reply) => {
    const deleted = await db.deleteParticipant(req.params.id)
    if (deleted?.photo_path) {
      const full = path.join(__dirname, '../../static', deleted.photo_path)
      fs.unlink(full, () => {})
    }
    return reply.redirect('/admin/participantes')
  })
}

/* ── Helpers ── */
async function parseForm(req) {
  const fields   = {}
  let photoPath  = null

  try {
    const parts = req.parts()
    for await (const part of parts) {
      if (part.type === 'field') {
        fields[part.fieldname] = part.value
      } else if (part.fieldname === 'photo' && part.filename) {
        if (!ALLOWED.has(part.mimetype)) {
          // consume stream to avoid hang
          part.file.resume()
          return { fields, photoPath: null, error: 'Solo se permiten imágenes JPG, PNG o WebP.' }
        }
        const ext  = path.extname(part.filename) || '.jpg'
        const name = `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`
        photoPath  = path.join(UPLOAD_DIR, name)
        await pipeline(part.file, fs.createWriteStream(photoPath))

        const stat = fs.statSync(photoPath)
        if (stat.size > MAX_MB * 1024 * 1024) {
          fs.unlink(photoPath, () => {})
          return { fields, photoPath: null, error: `La imagen no puede superar ${MAX_MB} MB.` }
        }
      } else {
        part.file?.resume()
      }
    }
  } catch (e) {
    return { fields, photoPath: null, error: 'Error al procesar el formulario.' }
  }

  return { fields, photoPath, error: null }
}
