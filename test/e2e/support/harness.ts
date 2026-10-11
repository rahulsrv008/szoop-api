/**
 * Boots the real Nest app against a throwaway Postgres for end-to-end tests.
 *
 * The schema is rebuilt from the entities (plus the dispatch SQL migrations)
 * for every test file, so the target database is wiped: the harness refuses
 * to run unless its name ends in `_test`.
 *
 *   TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD / TEST_DB_NAME
 *   (defaults: 127.0.0.1:5432, postgres, no password, clearit_test)
 */
import * as fs from 'fs';
import * as path from 'path';

const env = process.env;
env.DB_HOST = env.TEST_DB_HOST ?? '127.0.0.1';
env.DB_PORT = env.TEST_DB_PORT ?? '5432';
env.DB_USER = env.TEST_DB_USER ?? 'postgres';
env.DB_PASSWORD = env.TEST_DB_PASSWORD ?? '';
env.DB_NAME = env.TEST_DB_NAME ?? 'clearit_test';
env.DB_SSL = 'false';
env.DB_SCHEMA = 'public';
env.DISPATCH_TICK_MS = '0';
// Tests drive dispatch.tick() themselves; the request-driven tick has its own test.
env.DISPATCH_REQUEST_TICK_SECONDS = '0';
env.JWT_SECRET = env.JWT_SECRET || 'e2e-test-secret-not-for-real-use-0123456789';
// Razorpay in stub mode, and no cron route unless a test sets the secret.
delete env.RAZORPAY_KEY_ID;
delete env.RAZORPAY_KEY_SECRET;
delete env.RAZORPAY_WEBHOOK_SECRET;
delete env.CRON_SECRET;

if (!env.DB_NAME.endsWith('_test')) {
  throw new Error(
    `Refusing to run e2e tests against "${env.DB_NAME}": the database is wiped. Use a name ending in _test.`,
  );
}

import 'src/config/timezone';
import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, ObjectLiteral, Repository } from 'typeorm';
import * as E from 'src/database/entities';
import { h3CellOf } from 'src/common/geo/geo.util';
import { adminAccessStore } from 'src/common/auth/admin-access';
import { toDateString } from 'src/agent/shared/date.util';

export type Point = { lat: number; lng: number };

export interface Harness {
  app: INestApplication;
  ds: DataSource;
  get<T>(type: new (...args: never[]) => T): T;
  repo<T extends ObjectLiteral>(entity: new () => T): Repository<T>;
  close(): Promise<void>;
}

export async function startApp(): Promise<Harness> {
  // Build the schema first with a separate connection; the app itself never synchronizes.
  const setup = new DataSource({
    type: 'postgres',
    host: env.DB_HOST,
    port: Number(env.DB_PORT),
    username: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    entities: [path.join(__dirname, '../../../src/database/entities/*.ts')],
    synchronize: true,
    dropSchema: true,
  });
  await setup.initialize();
  await setup.query(`DO $$ BEGIN CREATE ROLE cladmin; EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  for (const file of ['dispatch_geo.sql', 'dispatch_offers.sql']) {
    await setup.query(fs.readFileSync(path.join(__dirname, '../../../sql', file), 'utf8'));
  }
  await setup.destroy();

  const { AppModule } = await import('src/app.module');
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  const ds = app.get(DataSource);
  return {
    app,
    ds,
    get: (type) => app.get(type),
    repo: (entity) => ds.getRepository(entity),
    close: () => app.close(),
  };
}

/** Runs admin service calls the way the admin interceptor would, as a super admin. */
export function asSuperAdmin<T>(fn: () => Promise<T>) {
  return adminAccessStore.run(
    { adminId: 'test-admin', role: 'SUPER_ADMIN', unrestricted: true, zoneIds: [] },
    fn,
  );
}

// ---------------------------------------------------------------- geography

/** Each scenario gets its own area ~50 km from the others, so they can't see each other's agents. */
export function area(index: number): Point {
  return { lat: 27.5 + index * 0.45, lng: 77.2 };
}

/** A point `km` north of `base`. */
export function north(base: Point, km: number): Point {
  return { lat: base.lat + km / 111.32, lng: base.lng };
}

// --------------------------------------------------------------------- time

/** Local (pinned IST) date and time `minutes` from now. */
export function at(minutes: number) {
  const when = new Date(Date.now() + minutes * 60_000);
  return { date: toDateString(when), time: when.toTimeString().slice(0, 8) };
}

export function dayOffset(days: number) {
  const when = new Date();
  when.setDate(when.getDate() + days);
  return toDateString(when);
}

// ---------------------------------------------------------------- factories

export class Factory {
  private seq = 0;
  readonly names = new Map<string, string>();

  constructor(private readonly h: Harness) {}

  private next() {
    this.seq += 1;
    return this.seq;
  }

  async zone(name = `Zone ${this.next()}`) {
    return this.h.repo(E.ServiceArea).save({ name, isActive: true } as Partial<E.ServiceArea>);
  }

  async service(name: string, pricePerHour = 300, durationMinutes = 60) {
    const service = await this.h.repo(E.Service).save({
      name,
      durationMinutes,
      isActive: true,
    } as Partial<E.Service>);
    await this.h.repo(E.ServicePricing).save({
      serviceId: service.id,
      serviceAreaId: null,
      pricePerHour: pricePerHour.toFixed(2),
      isActive: true,
    } as Partial<E.ServicePricing>);
    return service;
  }

  async skill(name: string, keywords: string) {
    return this.h.repo(E.Skill).save({
      code: `${name.toLowerCase().replace(/\W+/g, '-')}-${this.next()}`,
      name,
      category: 'home',
      trainingTrack: 'basic',
      matchKeywords: keywords,
      isActive: true,
    } as Partial<E.Skill>);
  }

  async admin() {
    return this.h.repo(E.Admin).save({
      email: `ops${this.next()}@clearit.test`,
      passwordHash: 'x',
      firstName: 'Ops',
      role: 'SUPER_ADMIN',
      isActive: true,
    } as Partial<E.Admin>);
  }

  async customer() {
    const user = await this.h.repo(E.User).save({
      mobile: `91${String(this.next()).padStart(8, '0')}`,
      userType: 'customer',
    } as Partial<E.User>);
    const customer = await this.h.repo(E.Customer).save({ userId: user.id } as Partial<E.Customer>);
    return { user, customer };
  }

  async address(
    customerId: string,
    point: Point | null,
    options: { zoneId?: string | null; pincode?: string; city?: string } = {},
  ) {
    return this.h.repo(E.CustomerAddress).save({
      customerId,
      addressLine1: `House ${this.next()}`,
      city: options.city ?? 'Delhi',
      pincode: options.pincode ?? null,
      latitude: point ? point.lat.toFixed(7) : null,
      longitude: point ? point.lng.toFixed(7) : null,
      h3Cell: point ? h3CellOf(point.lat, point.lng) : null,
      serviceAreaId: options.zoneId ?? null,
    } as Partial<E.CustomerAddress>);
  }

  /**
   * An approved agent. `live` is a GPS fix (`staleFix` makes it 3 h old),
   * `home` the registered address; `skills` are attached as VERIFIED.
   */
  async agent(
    name: string,
    options: {
      live?: Point;
      staleFix?: boolean;
      home?: Point;
      skills?: E.Skill[];
      zones?: string[];
      status?: string;
      approvalStatus?: string;
      boost?: boolean;
    } = {},
  ) {
    const user = await this.h.repo(E.User).save({
      mobile: `92${String(this.next()).padStart(8, '0')}`,
      userType: 'agent',
    } as Partial<E.User>);
    const recordedAt = new Date(Date.now() - (options.staleFix ? 3 * 3600_000 : 0)).toISOString();
    const agent = await this.h.repo(E.Agent).save({
      userId: user.id,
      firstName: name,
      approvalStatus: options.approvalStatus ?? 'APPROVED',
      status: options.status ?? 'ACTIVE',
      boostEnabled: options.boost ?? false,
      serviceAreas: options.zones ?? [],
      currentLocation: options.live
        ? { latitude: options.live.lat, longitude: options.live.lng, recordedAt }
        : null,
      currentH3Cell: options.live ? h3CellOf(options.live.lat, options.live.lng) : null,
      latitude: options.home ? options.home.lat.toFixed(7) : null,
      longitude: options.home ? options.home.lng.toFixed(7) : null,
      homeH3Cell: options.home ? h3CellOf(options.home.lat, options.home.lng) : null,
    } as Partial<E.Agent>);
    for (const skill of options.skills ?? []) {
      await this.h.repo(E.AgentSkill).save({
        agentId: agent.id,
        skillId: skill.id,
        selected: true,
        trainingStatus: 'VERIFIED',
      } as Partial<E.AgentSkill>);
    }
    this.names.set(agent.id, name);
    return agent;
  }

  /** A booking written straight to the DB (for dispatch/agent scenarios). */
  async booking(options: {
    customerId: string;
    service: E.Service;
    point: Point | null;
    when: { date: string; time: string };
    status?: E.Booking['status'];
    agentId?: string | null;
    zoneId?: string | null;
    planType?: E.Booking['planType'];
    durationMinutes?: number;
  }) {
    const address = await this.address(options.customerId, options.point, {
      zoneId: options.zoneId,
    });
    const booking = await this.h.repo(E.Booking).save({
      bookingNumber: `T${String(this.next()).padStart(6, '0')}`,
      customerId: options.customerId,
      addressId: address.id,
      serviceAreaId: options.zoneId ?? null,
      bookingDate: options.when.date,
      startTime: options.when.time,
      durationMinutes: options.durationMinutes ?? 60,
      subtotal: '300.00',
      discount: '0.00',
      tax: '0.00',
      totalAmount: '300.00',
      paymentStatus: 'PAID',
      status: options.status ?? 'paid',
      agentId: options.agentId ?? null,
      planType: options.planType ?? null,
      planTitle: options.service.name,
      startOtp: '4321',
    } as Partial<E.Booking>);
    await this.h.repo(E.BookingItem).save({
      bookingId: booking.id,
      serviceId: options.service.id,
      quantity: 1,
      durationMinutes: options.durationMinutes ?? 60,
      pricePerHour: '300.00',
      amount: '300.00',
    } as Partial<E.BookingItem>);
    return booking;
  }

  async unavailable(agentId: string, date: string, window?: { from: string; to: string }) {
    return this.h.repo(E.AgentAvailability).save({
      agentId,
      availabilityDate: date,
      isAvailable: !!window,
      startTime: window?.from ?? null,
      endTime: window?.to ?? null,
    } as Partial<E.AgentAvailability>);
  }
}

// ------------------------------------------------------------------ queries

export async function reload(h: Harness, bookingId: string) {
  return h.repo(E.Booking).findOneByOrFail({ id: bookingId });
}

/** Offers on a booking as sorted `name:wave:status` strings. */
export async function offersOf(h: Harness, factory: Factory, bookingId: string) {
  const rows = await h.repo(E.BookingOffer).find({ where: { bookingId } });
  return rows
    .map((row) => `${factory.names.get(row.agentId) ?? row.agentId}:${row.wave}:${row.status}`)
    .sort();
}

export async function dispatchState(h: Harness, bookingId: string) {
  return h.repo(E.BookingDispatch).findOneBy({ bookingId });
}

/** Makes every live offer on the booking lapse and the dispatcher due now. */
export async function lapseOffers(h: Harness, bookingId: string) {
  await h.ds.query(
    `UPDATE booking_offers SET expires_at = now() - interval '1 second' WHERE booking_id = $1 AND status = 'pending'`,
    [bookingId],
  );
  await h.ds.query(
    `UPDATE booking_dispatches SET next_action_at = now() - interval '1 second' WHERE booking_id = $1`,
    [bookingId],
  );
}

/** Asserts the promise rejects with an HTTP exception of `status`; returns its message. */
export async function rejectsWith(promise: Promise<unknown>, status: number) {
  try {
    await promise;
  } catch (err) {
    const actual = (err as { status?: number }).status;
    if (actual !== status) {
      throw new Error(`Expected HTTP ${status}, got ${actual ?? 'non-HTTP error'}: ${(err as Error).message}`);
    }
    return (err as Error).message;
  }
  throw new Error(`Expected HTTP ${status}, but the call succeeded`);
}
