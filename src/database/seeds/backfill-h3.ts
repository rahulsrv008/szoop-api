import 'src/config/timezone';
import 'dotenv/config';
import { AppDataSource } from 'src/data-source';
import { backfillH3Cells } from 'src/common/geo/h3-backfill';

/**
 * Fills h3_cell / current_h3_cell / home_h3_cell for rows written before those
 * columns existed. The app also does this at boot; this is for running it by hand.
 *   npm run backfill:h3
 */
async function main() {
  await AppDataSource.initialize();
  const counts = await backfillH3Cells(AppDataSource);
  console.log(
    `Backfilled H3 cells: ${counts.addresses} addresses, ${counts.agentLocations} agent locations, ${counts.agentHomes} agent homes`,
  );
  await AppDataSource.destroy();
}

main().catch(async (err) => {
  console.error(err);
  if (AppDataSource.isInitialized) await AppDataSource.destroy();
  process.exit(1);
});
