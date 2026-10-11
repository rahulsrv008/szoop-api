import { DataSource, IsNull, Not } from 'typeorm';
import { Agent, CustomerAddress } from 'src/database/entities';
import { h3CellOf } from './geo.util';

/**
 * Fills h3_cell / current_h3_cell / home_h3_cell on rows saved before those
 * columns existed. Only rows with coordinates and no cell are touched, so
 * re-running is cheap. Used at boot (ZoneResolverService) and by
 * `npm run backfill:h3`.
 */
export async function backfillH3Cells(dataSource: DataSource) {
  const addressRepo = dataSource.getRepository(CustomerAddress);
  const agentRepo = dataSource.getRepository(Agent);

  const addresses = await addressRepo.find({
    where: { h3Cell: IsNull(), latitude: Not(IsNull()), longitude: Not(IsNull()) },
    select: ['id', 'latitude', 'longitude'],
  });
  let addressCount = 0;
  for (const address of addresses) {
    const h3Cell = h3CellOf(address.latitude, address.longitude);
    if (!h3Cell) continue;
    await addressRepo.update({ id: address.id }, { h3Cell });
    addressCount += 1;
  }

  const located = await agentRepo.find({
    where: { currentH3Cell: IsNull(), currentLocation: Not(IsNull()) },
    select: ['id', 'currentLocation'],
  });
  let locationCount = 0;
  for (const agent of located) {
    const currentH3Cell = h3CellOf(
      agent.currentLocation?.latitude,
      agent.currentLocation?.longitude,
    );
    if (!currentH3Cell) continue;
    await agentRepo.update({ id: agent.id }, { currentH3Cell });
    locationCount += 1;
  }

  const homes = await agentRepo.find({
    where: { homeH3Cell: IsNull(), latitude: Not(IsNull()), longitude: Not(IsNull()) },
    select: ['id', 'latitude', 'longitude'],
  });
  let homeCount = 0;
  for (const agent of homes) {
    const homeH3Cell = h3CellOf(agent.latitude, agent.longitude);
    if (!homeH3Cell) continue;
    await agentRepo.update({ id: agent.id }, { homeH3Cell });
    homeCount += 1;
  }

  return { addresses: addressCount, agentLocations: locationCount, agentHomes: homeCount };
}
