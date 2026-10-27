import 'src/config/timezone';
import { loadEnvFiles } from 'src/config/env';
import * as bcrypt from 'bcryptjs';
import { AppDataSource } from 'src/data-source';
import { Admin } from 'src/database/entities';

loadEnvFiles();

/**
 * Creates (or resets the password of) an Admin Web login.
 *   npm run seed:admin -- admin@clearit.in 'StrongPass#1' "Ops" "Lead"
 * Falls back to ADMIN_EMAIL / ADMIN_PASSWORD from .env.
 */
async function main() {
  const [emailArg, passwordArg, firstName, lastName] = process.argv.slice(2);
  const email = emailArg || process.env.ADMIN_EMAIL;
  const password = passwordArg || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Usage: npm run seed:admin -- <email> <password> [firstName] [lastName]',
    );
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters');
  }

  await AppDataSource.initialize();
  const repo = AppDataSource.getRepository(Admin);

  const existing = await repo.findOne({ where: { email } });
  const passwordHash = await bcrypt.hash(password, 10);

  if (existing) {
    existing.passwordHash = passwordHash;
    existing.isActive = true;
    if (firstName) existing.firstName = firstName;
    if (lastName) existing.lastName = lastName;
    await repo.save(existing);
    console.log(`Password reset for existing admin ${email}`);
  } else {
    await repo.save(
      repo.create({
        email,
        passwordHash,
        firstName: firstName ?? 'Super',
        lastName: lastName ?? 'Admin',
        role: 'SUPER_ADMIN',
        isActive: true,
      }),
    );
    console.log(`Created admin ${email}`);
  }

  await AppDataSource.destroy();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
