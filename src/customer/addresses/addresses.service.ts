import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { Booking, Customer, CustomerAddress } from 'src/database/entities';
import { IdentityService } from 'src/common/auth/identity.service';
import { ZoneResolverService } from 'src/common/services/zone-resolver.service';
import { h3CellOf } from 'src/common/geo/geo.util';
import { CreateCustomerAddressDto } from './dto/create-address.dto';
import { UpdateCustomerAddressDto } from './dto/update-address.dto';

@Injectable()
export class CustomerAddressesService {
  constructor(
    @InjectRepository(CustomerAddress)
    private readonly addressRepo: Repository<CustomerAddress>,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    private readonly identity: IdentityService,
    private readonly zones: ZoneResolverService,
  ) {}

  async list(userId: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const addresses = await this.addressRepo.find({
      where: { customerId },
      relations: ['serviceArea'],
      order: { isDefault: 'DESC', createdAt: 'DESC' },
    });
    return addresses.map((address) => this.toResponse(address));
  }

  async create(userId: string, dto: CreateCustomerAddressDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    const existing = await this.addressRepo.count({ where: { customerId } });
    const zone = await this.zones.resolve({
      pincode: dto.pincode,
      latitude: dto.latitude,
      longitude: dto.longitude,
      city: dto.city,
    });

    const address = await this.addressRepo.save(
      this.addressRepo.create({
        customerId,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2 ?? null,
        landmark: dto.landmark ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        pincode: dto.pincode ?? null,
        latitude: dto.latitude === undefined ? null : String(dto.latitude),
        longitude: dto.longitude === undefined ? null : String(dto.longitude),
        h3Cell: h3CellOf(dto.latitude, dto.longitude),
        addressType: dto.addressType ?? null,
        serviceAreaId: zone?.id ?? null,
        // The very first address is always the default one.
        isDefault: dto.isDefault === true || existing === 0,
      }),
    );
    address.serviceArea = zone;

    if (address.isDefault) {
      await this.clearOtherDefaults(customerId, address.id);
      await this.syncHomeZone(customerId, zone?.id ?? null);
    }
    return this.toResponse(address);
  }

  async update(userId: string, id: string, dto: UpdateCustomerAddressDto) {
    const customerId = await this.identity.requireCustomerId(userId);
    const address = await this.findOwn(customerId, id);

    if (dto.addressLine1 !== undefined) address.addressLine1 = dto.addressLine1;
    if (dto.addressLine2 !== undefined) address.addressLine2 = dto.addressLine2;
    if (dto.landmark !== undefined) address.landmark = dto.landmark;
    if (dto.city !== undefined) address.city = dto.city;
    if (dto.state !== undefined) address.state = dto.state;
    if (dto.pincode !== undefined) address.pincode = dto.pincode;
    if (dto.latitude !== undefined) address.latitude = String(dto.latitude);
    if (dto.longitude !== undefined) address.longitude = String(dto.longitude);
    if (dto.addressType !== undefined) address.addressType = dto.addressType;
    if (dto.isDefault !== undefined) address.isDefault = dto.isDefault;
    address.h3Cell = h3CellOf(address.latitude, address.longitude);

    const zone = await this.zones.resolve({
      pincode: address.pincode,
      latitude: address.latitude == null ? null : Number(address.latitude),
      longitude: address.longitude == null ? null : Number(address.longitude),
      city: address.city,
    });
    address.serviceAreaId = zone?.id ?? null;
    address.serviceArea = zone;

    await this.addressRepo.save(address);
    if (address.isDefault) {
      await this.clearOtherDefaults(customerId, address.id);
      await this.syncHomeZone(customerId, zone?.id ?? null);
    }
    return this.toResponse(address);
  }

  async setDefault(userId: string, id: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const address = await this.findOwn(customerId, id);

    await this.clearOtherDefaults(customerId, address.id);
    address.isDefault = true;
    await this.addressRepo.save(address);
    await this.syncHomeZone(customerId, address.serviceAreaId);
    return this.toResponse(address);
  }

  async remove(userId: string, id: string) {
    const customerId = await this.identity.requireCustomerId(userId);
    const address = await this.findOwn(customerId, id);

    const usedByBookings = await this.bookingRepo.count({
      where: { addressId: address.id },
    });
    if (usedByBookings) {
      throw new ConflictException(
        'This address is used by a booking and cannot be deleted',
      );
    }

    const wasDefault = address.isDefault;
    await this.addressRepo.remove(address);
    if (wasDefault) {
      const next = await this.addressRepo.findOne({
        where: { customerId },
        order: { createdAt: 'DESC' },
      });
      if (next) {
        next.isDefault = true;
        await this.addressRepo.save(next);
        await this.syncHomeZone(customerId, next.serviceAreaId);
      } else {
        await this.syncHomeZone(customerId, null);
      }
    }
    return { id, deleted: true };
  }

  private async findOwn(customerId: string, id: string) {
    const address = await this.addressRepo.findOne({
      where: { id, customerId },
      relations: ['serviceArea'],
    });
    if (!address) throw new NotFoundException('Address not found');
    return address;
  }

  private async syncHomeZone(customerId: string, homeZoneId: string | null) {
    await this.customerRepo.update({ id: customerId }, { homeZoneId });
  }

  /** Keeps the "one default per customer" invariant. */
  private async clearOtherDefaults(customerId: string, keepId: string) {
    await this.addressRepo.update(
      { customerId, id: Not(keepId) },
      { isDefault: false },
    );
  }

  private toResponse(address: CustomerAddress) {
    return {
      id: address.id,
      addressLine1: address.addressLine1,
      addressLine2: address.addressLine2,
      landmark: address.landmark,
      city: address.city,
      state: address.state,
      pincode: address.pincode,
      latitude: address.latitude === null ? null : Number(address.latitude),
      longitude: address.longitude === null ? null : Number(address.longitude),
      addressType: address.addressType,
      isDefault: address.isDefault,
      serviceAreaId: address.serviceAreaId,
      zone: this.zones.summary(address.serviceArea),
      createdAt: address.createdAt,
      updatedAt: address.updatedAt,
    };
  }
}
