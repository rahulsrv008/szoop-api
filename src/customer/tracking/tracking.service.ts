import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentLocation, Booking, BookingStatusHistory } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';

@Injectable()
export class CustomerTrackingService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(AgentLocation)
    private readonly locationRepo: Repository<AgentLocation>,
    @InjectRepository(BookingStatusHistory)
    private readonly historyRepo: Repository<BookingStatusHistory>,
    private readonly identity: IdentityService,
  ) {}

  async tracking(userId: string, bookingId: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, customerId },
      relations: ['address'],
    });
    if (!booking) throw new NotFoundException('Booking not found');

    let lastPing = await this.locationRepo.findOne({
      where: { bookingId: booking.id },
      order: { recordedAt: 'DESC' },
    });

    if (!lastPing && booking.agentId) {
      lastPing = await this.locationRepo.findOne({
        where: { agentId: booking.agentId },
        order: { recordedAt: 'DESC' },
      });
    }

    const ping = lastPing
      ? {
          latitude: Number(lastPing.latitude),
          longitude: Number(lastPing.longitude),
          recordedAt: lastPing.recordedAt,
        }
      : null;
    const destination =
      booking.address?.latitude && booking.address?.longitude
        ? {
            latitude: Number(booking.address.latitude),
            longitude: Number(booking.address.longitude),
          }
        : null;
    const distanceKm =
      ping && destination
        ? haversineKm(ping.latitude, ping.longitude, destination.latitude, destination.longitude)
        : null;
    const moving = booking.status === 'accepted' || booking.status === 'arriving';
    const started =
      booking.status === 'ongoing'
        ? await this.historyRepo.findOne({
            where: { bookingId: booking.id, status: 'ongoing' },
            order: { createdAt: 'DESC' },
          })
        : null;

    return {
      bookingId: booking.id,
      bookingNumber: booking.bookingNumber,
      status: booking.status,
      agentId: booking.agentId,
      live: moving && !!ping,
      lastPing: moving ? ping : null,
      destination: moving ? destination : null,
      distanceKm: !moving || distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
      etaMinutes:
        distanceKm === null || !moving
          ? null
          : Math.max(1, Math.round((distanceKm / 18) * 60)),
      durationMinutes: booking.durationMinutes,
      startedAt: started?.createdAt ?? null,
    };
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}
