import pg from 'pg'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://app:secret@localhost:5432/noche_talentos'
})

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tickets (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name         VARCHAR(255) NOT NULL,
      phone        VARCHAR(50)  NOT NULL,
      email        VARCHAR(255) NOT NULL,
      created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      validated_at TIMESTAMPTZ,
      is_valid     BOOLEAN NOT NULL DEFAULT true,
      is_paid      BOOLEAN NOT NULL DEFAULT false,
      paid_at      TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS idx_tickets_email ON tickets(email);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_paid BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS participants (
      id            SERIAL PRIMARY KEY,
      name          VARCHAR(255) NOT NULL,
      role          VARCHAR(255) NOT NULL,
      description   TEXT,
      photo_path    VARCHAR(500),
      display_order INT NOT NULL DEFAULT 0,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ministries (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) NOT NULL,
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS ministry_id INT REFERENCES ministries(id) ON DELETE SET NULL;
    ALTER TABLE ministries ADD COLUMN IF NOT EXISTS display_order INT NOT NULL DEFAULT 0;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS transfer_proof VARCHAR(500);
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_child BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS adult_count INT NOT NULL DEFAULT 1;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS child_count INT NOT NULL DEFAULT 0;
    ALTER TABLE tickets ADD COLUMN IF NOT EXISTS price INT NOT NULL DEFAULT 300;

    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(500) NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_token VARCHAR(128);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;
  `)
}

export const db = {
  /* ── Tickets ── */
  async createTicket(name, phone, email, ministry_id, transfer_proof, adult_count = 1, child_count = 0) {
    const price = adult_count * 300 + child_count * 100
    const { rows } = await pool.query(
      `INSERT INTO tickets (name, phone, email, ministry_id, transfer_proof, adult_count, child_count, price) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [name, phone, email, ministry_id || null, transfer_proof || null, adult_count, child_count, price]
    )
    return rows[0]
  },
  async getTicket(id) {
    const { rows } = await pool.query(
      `SELECT t.*, m.name AS ministry_name
       FROM tickets t LEFT JOIN ministries m ON m.id = t.ministry_id
       WHERE t.id = $1`, [id]
    )
    return rows[0] || null
  },
  async listTickets({ search = null, page = 1, limit = 25 } = {}) {
    const q = search ? `%${search}%` : null
    const offset = (page - 1) * limit
    const [dataRes, countRes] = await Promise.all([
      pool.query(
        `SELECT t.*, m.name AS ministry_name
         FROM tickets t LEFT JOIN ministries m ON m.id = t.ministry_id
         WHERE ($1::text IS NULL OR t.name ILIKE $1 OR t.phone ILIKE $1 OR t.id::text ILIKE $1)
         ORDER BY t.created_at DESC
         LIMIT $2 OFFSET $3`,
        [q, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS total
         FROM tickets t
         WHERE ($1::text IS NULL OR t.name ILIKE $1 OR t.phone ILIKE $1 OR t.id::text ILIKE $1)`,
        [q]
      )
    ])
    return { rows: dataRes.rows, total: parseInt(countRes.rows[0].total) }
  },
  async findTicketsByPhone(phone) {
    const digits = phone.replace(/\D/g, '')
    const { rows } = await pool.query(
      `SELECT t.*, m.name AS ministry_name
       FROM tickets t LEFT JOIN ministries m ON m.id = t.ministry_id
       WHERE REGEXP_REPLACE(t.phone, '[^0-9]', '', 'g') LIKE $1
       AND t.is_valid = true
       ORDER BY t.created_at DESC`,
      [`%${digits}%`]
    )
    return rows
  },
  async findTicketsByNameOrPhone(query) {
    const digits = query.replace(/\D/g, '')
    const { rows } = await pool.query(
      `SELECT t.*, m.name AS ministry_name
       FROM tickets t LEFT JOIN ministries m ON m.id = t.ministry_id
       WHERE t.is_valid = true
         AND (
           t.name ILIKE $1
           OR ($2 <> '' AND REGEXP_REPLACE(t.phone, '[^0-9]', '', 'g') LIKE $3)
         )
       ORDER BY t.created_at DESC`,
      [`%${query}%`, digits, `%${digits}%`]
    )
    return rows
  },
  async validateAndPay(id) {
    const { rows } = await pool.query(
      `UPDATE tickets
       SET validated_at = COALESCE(validated_at, NOW()),
           is_paid      = true,
           paid_at      = COALESCE(paid_at, NOW())
       WHERE id = $1 AND is_valid = true
       RETURNING *`,
      [id]
    )
    return rows[0] || null
  },
  async validateTicket(id) {
    const { rows } = await pool.query(
      `UPDATE tickets SET validated_at = NOW()
       WHERE id = $1 AND validated_at IS NULL AND is_valid = true RETURNING *`, [id]
    )
    return rows[0] || null
  },
  async markPaid(id) {
    const { rows } = await pool.query(
      `UPDATE tickets SET is_paid = true, paid_at = NOW()
       WHERE id = $1 AND is_paid = false RETURNING *`, [id]
    )
    return rows[0] || null
  },
  async markUnpaid(id) {
    const { rows } = await pool.query(
      `UPDATE tickets SET is_paid = false, paid_at = NULL WHERE id = $1 RETURNING *`, [id]
    )
    return rows[0] || null
  },
  async updateCounts(id, adult_count, child_count) {
    const price = adult_count * 300 + child_count * 100
    const { rows } = await pool.query(
      `UPDATE tickets SET adult_count=$1, child_count=$2, price=$3 WHERE id=$4 RETURNING *`,
      [adult_count, child_count, price, id]
    )
    return rows[0] || null
  },
  async toggleChild(id) {
    const { rows } = await pool.query(
      `UPDATE tickets SET is_child = NOT is_child WHERE id = $1 RETURNING *`, [id]
    )
    return rows[0] || null
  },
  async deleteTicket(id) {
    const { rows } = await pool.query(
      `DELETE FROM tickets WHERE id = $1 RETURNING id`, [id]
    )
    return rows[0] || null
  },
  async stats() {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS total, COUNT(validated_at) AS validated,
              COUNT(*) - COUNT(validated_at) AS pending,
              COUNT(*) FILTER (WHERE is_paid) AS paid,
              SUM(child_count) AS children,
              SUM(adult_count) AS adults,
              SUM(price) AS revenue
       FROM tickets WHERE is_valid = true`
    )
    return rows[0]
  },

  /* ── Participants ── */
  async listParticipants({ activeOnly = false } = {}) {
    const where = activeOnly ? 'WHERE active = true' : ''
    const { rows } = await pool.query(
      `SELECT * FROM participants ${where} ORDER BY display_order ASC, id ASC`
    )
    return rows
  },
  async getParticipant(id) {
    const { rows } = await pool.query(`SELECT * FROM participants WHERE id = $1`, [id])
    return rows[0] || null
  },
  async createParticipant({ name, role, description, photo_path, display_order, active }) {
    const { rows } = await pool.query(
      `INSERT INTO participants (name, role, description, photo_path, display_order, active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, role, description || null, photo_path || null, display_order ?? 0, active ?? true]
    )
    return rows[0]
  },
  async updateParticipant(id, { name, role, description, photo_path, display_order, active }) {
    const { rows } = await pool.query(
      `UPDATE participants SET name=$1, role=$2, description=$3,
        photo_path=COALESCE($4, photo_path), display_order=$5, active=$6
       WHERE id=$7 RETURNING *`,
      [name, role, description || null, photo_path || null, display_order ?? 0, active ?? true, id]
    )
    return rows[0] || null
  },
  async deleteParticipant(id) {
    const { rows } = await pool.query(
      `DELETE FROM participants WHERE id=$1 RETURNING photo_path`, [id]
    )
    return rows[0] || null
  },

  /* ── Ministries ── */
  async listMinistries({ activeOnly = false } = {}) {
    const where = activeOnly ? 'WHERE active = true' : ''
    const { rows } = await pool.query(
      `SELECT * FROM ministries ${where} ORDER BY display_order ASC, id ASC`
    )
    return rows
  },
  async createMinistry(name) {
    const { rows: [{ max }] } = await pool.query(`SELECT COALESCE(MAX(display_order), -1) AS max FROM ministries`)
    const { rows } = await pool.query(
      `INSERT INTO ministries (name, display_order) VALUES ($1, $2) RETURNING *`,
      [name.trim(), max + 1]
    )
    return rows[0]
  },
  async updateMinistry(id, name) {
    const { rows } = await pool.query(
      `UPDATE ministries SET name=$1 WHERE id=$2 RETURNING *`, [name.trim(), id]
    )
    return rows[0] || null
  },
  async reorderMinistries(ids) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      for (let i = 0; i < ids.length; i++) {
        await client.query('UPDATE ministries SET display_order=$1 WHERE id=$2', [i, ids[i]])
      }
      await client.query('COMMIT')
    } catch (e) {
      await client.query('ROLLBACK')
      throw e
    } finally {
      client.release()
    }
  },
  async deleteMinistry(id) {
    const { rows } = await pool.query(
      `DELETE FROM ministries WHERE id=$1 RETURNING *`, [id]
    )
    return rows[0] || null
  },
  async toggleMinistry(id) {
    const { rows } = await pool.query(
      `UPDATE ministries SET active = NOT active WHERE id=$1 RETURNING *`, [id]
    )
    return rows[0] || null
  },

  /* ── Users ── */
  async listUsers() {
    const { rows } = await pool.query(
      `SELECT id, username, password_hash, invite_token, invite_expires_at, created_at FROM users ORDER BY id ASC`
    )
    return rows
  },
  async getUserByUsername(username) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE username = $1`, [username]
    )
    return rows[0] || null
  },
  async getUserById(id) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE id = $1`, [id]
    )
    return rows[0] || null
  },
  async createUser(username, password_hash) {
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at`,
      [username.trim().toLowerCase(), password_hash]
    )
    return rows[0]
  },
  async createInviteUser(username, invite_token, invite_expires_at) {
    const { rows } = await pool.query(
      `INSERT INTO users (username, invite_token, invite_expires_at) VALUES ($1, $2, $3) RETURNING id, username`,
      [username.trim().toLowerCase(), invite_token, invite_expires_at]
    )
    return rows[0]
  },
  async getUserByInviteToken(token) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE invite_token = $1 AND invite_expires_at > NOW()`,
      [token]
    )
    return rows[0] || null
  },
  async activateUser(id, password_hash) {
    const { rows } = await pool.query(
      `UPDATE users SET password_hash=$1, invite_token=NULL, invite_expires_at=NULL WHERE id=$2 RETURNING id, username`,
      [password_hash, id]
    )
    return rows[0] || null
  },
  async regenerateInvite(id, invite_token, invite_expires_at) {
    const { rows } = await pool.query(
      `UPDATE users SET invite_token=$1, invite_expires_at=$2 WHERE id=$3 RETURNING id, username`,
      [invite_token, invite_expires_at, id]
    )
    return rows[0] || null
  },
  async changePassword(id, password_hash) {
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username`,
      [password_hash, id]
    )
    return rows[0] || null
  },
  async deleteUser(id) {
    const { rows } = await pool.query(
      `DELETE FROM users WHERE id = $1 RETURNING id`, [id]
    )
    return rows[0] || null
  },
  async countUsers() {
    const { rows } = await pool.query(`SELECT COUNT(*) AS count FROM users`)
    return parseInt(rows[0].count)
  }
}
