import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'net';
import { Factory, Harness, startApp } from './support/harness';
import * as E from 'src/database/entities';
import { TokenService } from 'src/common/auth/token.service';
import { ServiceabilityService } from 'src/common/services/serviceability.service';

describe('Serviceability and "coming soon" cities', () => {
  let h: Harness;
  let baseUrl: string;
  let token: string;
  let customer: E.Customer;

  before(async () => {
    h = await startApp();
    await h.app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
    const f = new Factory(h);
    const created = await f.customer();
    customer = created.customer;
    token = (
      await h.get(TokenService).issueSession({
        sub: created.user.id,
        role: 'customer',
        customerId: customer.id,
      } as never)
    ).accessToken;
  });
  after(() => h.close());

  const check = async (query: Record<string, string | number>) => {
    const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
    const res = await fetch(`${baseUrl}/customer/serviceability?${qs}`);
    assert.equal(res.status, 200);
    return res.json();
  };

  it('serves a pin inside a seeded NCR zone', async () => {
    const body = await check({ latitude: 28.59, longitude: 77.32 });
    assert.equal(body.serviceable, true);
    assert.ok(body.zone.id);
  });

  it('greets an Agra pin as Taj City', async () => {
    const body = await check({ latitude: 27.1751, longitude: 78.0421 });
    assert.equal(body.serviceable, false);
    assert.equal(body.city, 'Agra');
    assert.equal(body.nickname, 'Taj City');
    assert.equal(body.message, "We'll be available soon in Taj City!");
  });

  it('matches a typed city by alias when there is no pin', async () => {
    const body = await check({ city: 'Agra Cantt' });
    assert.equal(body.nickname, 'Taj City');
    assert.equal((await check({ city: 'BANGALORE' })).nickname, 'Garden City');
  });

  it('falls back to the plain city name, then to a generic line', async () => {
    const shimla = await check({ city: 'Shimla' });
    assert.equal(shimla.message, "We'll be available soon in Shimla!");
    assert.equal(shimla.canNotify, true);

    const nowhere = await check({ latitude: 10.0, longitude: 70.0 });
    assert.equal(nowhere.city, null);
    assert.equal(nowhere.canNotify, false);
    assert.match(nowhere.message, /not in your area yet/);
  });

  it('uses an admin-written message over the default', async () => {
    await h.repo(E.UpcomingCity).update({ city: 'Jaipur' }, { message: 'Pink City, we are coming!' });
    // Direct DB edits show up within a minute; clear the cache to see it now.
    h.get(ServiceabilityService).invalidateCache();
    assert.equal((await check({ city: 'Jaipur' })).message, 'Pink City, we are coming!');
  });

  it('"Notify me" needs sign-in and records one row per city', async () => {
    const body = JSON.stringify({ latitude: 27.1751, longitude: 78.0421 });
    const anon = await fetch(`${baseUrl}/customer/serviceability/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    assert.equal(anon.status, 401);

    const post = () =>
      fetch(`${baseUrl}/customer/serviceability/notify`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body,
      });
    const first = await (await post()).json();
    assert.equal(first.joined, true);
    assert.equal(first.status.nickname, 'Taj City');
    await post();

    const rows = await h.repo(E.CityWaitlist).find({ where: { customerId: customer.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cityKey, 'agra');
  });
});
