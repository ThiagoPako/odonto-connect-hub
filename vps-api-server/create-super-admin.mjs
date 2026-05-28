import pg from 'pg';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
  host: process.env.PG_HOST || 'localhost',
  port: Number(process.env.PG_PORT) || 5432,
  database: process.env.PG_DATABASE || 'odonto_db',
  user: process.env.PG_USER || 'odonto_user',
  password: process.env.PG_PASSWORD,
});

async function createSuperAdmin() {
  try {
    const email = 'superadmin@odontoconnect.tech';
    const password = 'Connect#SecureAdmin@2026'; // Senha alterada para maior segurança
    const name = 'Super Admin';
    const hash = await bcrypt.hash(password, 12);

    console.log(`Checking for user ${email}...`);
    const { rows } = await pool.query('SELECT id FROM profiles WHERE email = $1', [email]);

    if (rows.length > 0) {
      console.log('User exists, updating to Super Admin...');
      await pool.query(
        'UPDATE profiles SET is_super_admin = true, role = $1, active = true WHERE id = $2',
        ['admin', rows[0].id]
      );
      console.log('User updated successfully.');
    } else {
      console.log('Creating new Super Admin user...');
      const id = crypto.randomUUID();
      await pool.query(
        'INSERT INTO profiles (id, name, email, role, password_hash, is_super_admin, active) VALUES ($1, $2, $3, $4, $5, true, true)',
        [id, name, email, 'admin', hash]
      );
      await pool.query(
        'INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [id, 'admin']
      );
      console.log('Super Admin created successfully.');
    }
  } catch (err) {
    console.error('Error creating super admin:', err.message);
  } finally {
    await pool.end();
  }
}

createSuperAdmin();
