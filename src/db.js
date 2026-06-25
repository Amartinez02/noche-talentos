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
  `)
}

export const db = {
  /* ── Tickets ── */
  async createTicket(name, phone, email, ministry_id) {
    const { rows } = await pool.query(
      `INSERT INTO tickets (name, phone, email, ministry_id) VALUES ($1, $2, $3, $4) RETURNING *`,
      [name, phone, email, ministry_id || null]
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
  async listTickets() {
    const { rows } = await pool.query(
      `SELECT t.*, m.name AS ministry_name
       FROM tickets t LEFT JOIN ministries m ON m.id = t.ministry_id
       ORDER BY t.created_at DESC`
    )
    return rows
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
              COUNT(*) * 300 AS revenue
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
  }
}
