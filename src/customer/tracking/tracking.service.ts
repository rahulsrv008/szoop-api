import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentLocation, Booking, BookingStatusHistory } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { haversineKm } from 'src/common/geo/geo.util';
import { BookingEtaService } from 'src/integrations/maps/booking-eta.service';

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
    private readonly bookingEta: BookingEtaService,
  ) { }

  async tracking(userId: string, bookingId: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const booking = await this.bookingRepo.findOne({
      where: { id: bookingId, customerId },
      relations: ['address', 'agent'],
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

    // Pings tagged with this booking, or the agent's latest fix if it is newer
    // (the app doesn't always tag pings while travelling).
    const tagged = lastPing
      ? {
        latitude: Number(lastPing.latitude),
        longitude: Number(lastPing.longitude),
        recordedAt: new Date(lastPing.recordedAt),
      }
      : null;
    const fix = booking.agent?.currentLocation;
    const latestFix = fix
      ? { latitude: fix.latitude, longitude: fix.longitude, recordedAt: new Date(fix.recordedAt) }
      : null;
    const ping =
      latestFix && (!tagged || latestFix.recordedAt > tagged.recordedAt) ? latestFix : tagged;

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
    const eta =
      booking.status === 'arriving'
        ? await this.bookingEta.current(booking.id, ping, destination).catch(() => null)
        : null;
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
      lastPing: moving && ping ? { ...ping, recordedAt: ping.recordedAt.toISOString() } : null,
      destination: moving ? destination : null,
      distanceKm: !moving || distanceKm === null ? null : Math.round(distanceKm * 10) / 10,
      etaMinutes: eta
        ? eta.remainingMinutes
        : distanceKm === null || !moving
          ? null
          : Math.max(1, Math.round((distanceKm / 18) * 60)),
      etaSource: eta?.source ?? (distanceKm === null || !moving ? null : 'estimate'),
      routeDistanceKm: eta?.distanceKm ?? null,
      durationMinutes: booking.durationMinutes,
      startedAt: started?.createdAt ?? null,
    };
  }
}
