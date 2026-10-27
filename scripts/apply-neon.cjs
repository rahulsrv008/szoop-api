const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const SQL_DIR = path.join(ROOT, 'sql');
const SKIP = new Set(['aiven_create_tables.sql', 'pgadmin_full_setup.sql']);

function connectionString() {
  const user = encodeURIComponent(process.env.DB_USER);
  const password = encodeURIComponent(process.env.DB_PASSWORD);
  const host = process.env.DB_HOST;
  const port = process.env.DB_PORT || '5432';
  const name = process.env.DB_NAME;
  return `postgresql://${user}:${password}@${host}:${port}/${name}?sslmode=require`;
}

async function main() {
  const url = connectionString();
  console.log(`Connecting ${process.env.DB_HOST}/${process.env.DB_NAME}`);

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected');

  const files = fs.readdirSync(SQL_DIR).filter((f) => f.endsWith('.sql') && !SKIP.has(f));
  files.sort((a, b) => a.localeCompare(b));
  const ordered = [
    ...files.filter((f) => f.startsWith('001_')),
    ...files.filter((f) => f.startsWith('002_')),
    ...files.filter((f) => f === 'home_content.sql'),
    ...files.filter(
      (f) => !f.startsWith('001_') && !f.startsWith('002_') && f !== 'home_content.sql',
    ),
  ];

  for (const file of ordered) {
    const sql = fs
      .readFileSync(path.join(SQL_DIR, file), 'utf8')
      .replace(/^GRANT .* TO cladmin;?\s*$/gim, '');
    process.stdout.write(`SQL ${file} ... `);
    try {
      await client.query(sql);
      console.log('ok');
    } catch (err) {
      console.log('FAIL');
      console.error(`  ${err.message}`);
      throw err;
    }
  }

  await client.query(`
    DO $$
    DECLARE t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY['customers', 'agents', 'users']
      LOOP
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = t
        ) THEN
          EXECUTE format('TRUNCATE TABLE %I CASCADE', t);
        END IF;
      END LOOP;
    END $$;
  `);
  const counts = await client.query(`
    SELECT
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM customers) AS customers,
      (SELECT count(*) FROM agents) AS agents,
      (SELECT count(*) FROM admins) AS admins
  `);
  console.log('Fresh counts', counts.rows[0]);
  await client.end();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
