import path from 'path'
import { fileURLToPath } from 'url'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import fastifyView from '@fastify/view'
import fastifyFormbody from '@fastify/formbody'
import fastifyCookie from '@fastify/cookie'
import fastifyMultipart from '@fastify/multipart'
import nunjucks from 'nunjucks'

import { migrate } from './db.js'
import { publicRoutes } from './routes/public.js'
import { adminRoutes } from './routes/admin.js'
import { participantRoutes } from './routes/participants.js'
import { ministryRoutes } from './routes/ministries.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const fastify = Fastify({ logger: true })

await fastify.register(fastifyCookie)
await fastify.register(fastifyFormbody)
await fastify.register(fastifyMultipart, { limits: { fileSize: 6 * 1024 * 1024 } })
await fastify.register(fastifyStatic, {
  root: path.join(ROOT, 'static'),
  prefix: '/static/'
})
// Servir uploads directamente en /uploads/ (sin prefijo /static/)
await fastify.register(fastifyStatic, {
  root: path.join(ROOT, 'static/uploads'),
  prefix: '/uploads/',
  decorateReply: false
})
await fastify.register(fastifyView, {
  engine: { nunjucks },
  root: path.join(ROOT, 'templates'),
  options: { noCache: process.env.NODE_ENV !== 'production' }
})

await fastify.register(publicRoutes)
await fastify.register(adminRoutes)
await fastify.register(participantRoutes)
await fastify.register(ministryRoutes)

fastify.setErrorHandler((err, req, reply) => {
  fastify.log.error(err)
  reply.code(500).send({ error: 'Internal Server Error' })
})
fastify.setNotFoundHandler((req, reply) => {
  reply.code(404).send({ error: 'Not Found' })
})

try {
  await migrate()
  fastify.log.info('Database ready')
  await fastify.listen({ port: 8080, host: '0.0.0.0' })
} catch (err) {
  fastify.log.error(err)
  process.exit(1)
}
