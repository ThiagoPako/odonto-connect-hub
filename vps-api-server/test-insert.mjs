import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

const tenantId = '426e9a3e-9216-41be-99a9-7b345c74d62b';
const clinic = {
  id: 6242775967727616,
  CompanyId: "21705874000114",
  BusinessName: "Luiz Gustavo Pereira Lara",
  Name: "SORRISO CLÍNICA ODONTOLÓGICA",
  Address: "Av. Maranhão, 1250, Centro, Minaçu - GO",
  Email: "sorrisoclinicaodontologica16@gmail.com"
};

async function testInsert() {
  console.log('Testing direct INSERT into clinicorp_clinics...');
  try {
    const res = await pool.query(
      `INSERT INTO clinicorp_clinics (id, tenant_id, name, business_name, address, email, synced_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (id, tenant_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING *`,
      [clinic.id, tenantId, clinic.Name, clinic.BusinessName, clinic.Address, clinic.Email]
    );
    console.log('Inserted:', res.rows[0]);
  } catch (e) {
    console.error('Insert failed:', e.message);
  } finally {
    await pool.end();
  }
}

testInsert();
