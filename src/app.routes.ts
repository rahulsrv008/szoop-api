/* eslint-disable prettier/prettier */
import 'dotenv/config';

/**
 * Every HTTP path in one place.
 * `API_PREFIX` is applied globally in main.ts, so the values below are the
 * segments that come after `/api/v1`.
 */
export const ROUTES = {
  API_PREFIX: process.env.API_PREFIX || 'api/v1',
  SWAGGER: process.env.SWAGGER_ROUTE || 'api',
  HEALTH: process.env.HEALTH_CONTROLLER || 'health',

  /** Machine-to-machine routes (cron), never called by the apps. */
  INTERNAL: {
    DISPATCH: 'internal/dispatch',
  },

  CUSTOMER: {
    AUTH: 'customer/auth',
    PROFILE: 'customer/profile',
    ADDRESSES: 'customer/addresses',
    SERVICES: 'customer/services',
    BOOKINGS: 'customer/bookings',
    PAYMENTS: 'customer/payments',
    RATINGS: 'customer/ratings',
    NOTIFICATIONS: 'customer/notifications',
    SUPPORT: 'customer/support',
    HOME: 'customer/home',
    SERVICEABILITY: 'customer/serviceability',
  },

  AGENT: {
    AUTH: 'agent/auth',
    REGISTRATION: 'agent/registration',
    BANK_DETAILS: 'agent/bank-details',
    DOCUMENTS: 'agent/documents',
    PROFILE: 'agent/profile',
    AVAILABILITY: 'agent/availability',
    SKILLS: 'agent/skills',
    BOOST: 'agent/boost',
    BOOKINGS: 'agent/bookings',
    LOCATION: 'agent/location',
    ATTENDANCE: 'agent/attendance',
    EARNINGS: 'agent/earnings',
    INCENTIVES: 'agent/incentives',
    RATINGS: 'agent/ratings',
    NOTIFICATIONS: 'agent/notifications',
    SUPPORT: 'agent/support',
  },

  ADMIN: {
    AUTH: 'admin/auth',
    ADMINS: 'admin/admins',
    DASHBOARD: 'admin/dashboard',
    CUSTOMERS: 'admin/customers',
    AGENTS: 'admin/agents',
    ATTENDANCE: 'admin/attendance',
    SERVICES: 'admin/services',
    SERVICE_CATEGORIES: 'admin/service-categories',
    PRICING: 'admin/pricing',
    BOOKINGS: 'admin/bookings',
    PAYMENTS: 'admin/payments',
    EARNINGS: 'admin/earnings',
    COUPONS: 'admin/coupons',
    SERVICE_AREAS: 'admin/service-areas',
    SOCIETIES: 'admin/societies',
    RATINGS: 'admin/ratings',
    SUPPORT: 'admin/support',
    REPORTS: 'admin/reports',
    NOTIFICATIONS: 'admin/notifications',
    SETTINGS: 'admin/settings',
    HOME_CONTENT: 'admin/home-content',
  },

  WEBHOOKS: {
    PAYMENTS: 'webhooks/payments',
  },
};
