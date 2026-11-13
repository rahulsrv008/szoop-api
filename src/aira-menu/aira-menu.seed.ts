import type { AiraItemKind, AiraSegment } from 'src/database/entities';

/** The Aira Luxury menu as it shipped in the app; loaded once into an empty database. */
export const SEED_GROUPS: {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  segment: AiraSegment;
}[] = [
  { id: 'waxing', title: 'Waxing Studio', icon: 'leaf', blurb: 'Rica, honey, roll-on and painless wax', segment: 'women' },
  { id: 'facial', title: 'Facial & Glow', icon: 'sparkles', blurb: 'Hydra facial, O3+, cleanups and detan', segment: 'women' },
  { id: 'monthly', title: 'Value Combos', icon: 'calendar', blurb: 'Most booked monthly head-to-toe packages', segment: 'women' },
  { id: 'hair', title: 'Hair Studio', icon: 'cut', blurb: 'Botoplex, hair spa, color and blowdry', segment: 'women' },
  { id: 'manipedi', title: 'Mani & Pedi Bar', icon: 'flower', blurb: 'Rose petal pedicure, gel nails and mani', segment: 'women' },
  { id: 'spa', title: 'Body Spa & Relax', icon: 'heart', blurb: 'Swedish, deep tissue & aroma therapy at home', segment: 'spa' },
  { id: 'bridal', title: 'Bridal & Pre-Bridal', icon: 'diamond', blurb: 'Royal 7-day bridal glow and makeup', segment: 'bridal' },
  { id: 'quick', title: 'Threading & Face', icon: 'flash', blurb: 'Brows, upper lip, chin and touch-ups', segment: 'women' },
  { id: 'men', title: "Men's Grooming", icon: 'man', blurb: 'Haircut, beard trim, detan and facial', segment: 'men' },
];

/** Menu headings in the order the app lists them. */
export const SEED_SECTIONS = [
  'Value Combos',
  'Waxing',
  'Facial & cleanup',
  'Spa & Massage',
  'Manicure & Pedicure',
  'Hair Studio',
  'Bleach & detan',
  'Bridal & Makeup',
  'Threading',
  "Men's Grooming",
];

type SeedItem = {
  id: string;
  kind: AiraItemKind;
  title: string;
  group: string;
  section: string;
  minutes: number;
  price: number;
  originalPrice?: number;
  rating?: number;
  reviewsCount?: number;
  badge?: string;
  segment?: AiraSegment;
  includes: string[];
};

export const SEED_ITEMS: SeedItem[] = [
  { id: 'pkg-complete-glow', kind: 'package', title: 'Complete Monthly Grooming Combo', group: 'monthly', section: 'Value Combos', minutes: 90, price: 999, originalPrice: 1899, rating: 4.9, reviewsCount: 18400, badge: 'BESTSELLER', segment: 'women', includes: ['Full Arms + Full Legs Waxing', 'Underarms Honey Wax', 'O3+ Face Detan', 'Lotus Face Cleanup', 'Eyebrow + Upper Lip'] },
  { id: 'pkg-rica-lux', kind: 'package', title: 'Rica Roll-on Luxury Pampering', group: 'waxing', section: 'Value Combos', minutes: 110, price: 1399, originalPrice: 2499, rating: 4.95, reviewsCount: 12200, badge: 'SAVE 44%', segment: 'women', includes: ['Rica White Chocolate Wax (Arms & Legs)', 'Underarms Wax', 'Sara Herbal D-Tan', 'Rose Petal Classic Pedicure', 'Threading'] },
  { id: 'pkg-hydra-facial-luxe', kind: 'package', title: 'Hydra-Glow Deluxe Facial + Head Spa', group: 'facial', section: 'Value Combos', minutes: 75, price: 1299, originalPrice: 2200, rating: 4.88, reviewsCount: 9600, badge: 'TRENDING', segment: 'women', includes: ['Hydra Vacuum Pore Cleansing', 'Hyaluronic Acid Serum Infusion', 'Face Detan Pack', '20-min Relaxing Head Massage'] },
  { id: 'pkg-full-body-spa', kind: 'package', title: 'Royal Full Body Swedish Spa & Aroma Massage', group: 'spa', section: 'Spa & Massage', minutes: 60, price: 1199, originalPrice: 1999, rating: 4.92, reviewsCount: 7800, badge: 'LUXURY', segment: 'spa', includes: ['60-Min Swedish Body Massage', 'Warm Sesame & Lavender Oil', 'Hot Towel Wrap', 'Zero Mess Disposable Sheet Setup'] },
  { id: 'pkg-deep-tissue', kind: 'package', title: 'Deep Tissue Pain Relief Massage', group: 'spa', section: 'Spa & Massage', minutes: 60, price: 1299, originalPrice: 2199, rating: 4.87, reviewsCount: 5400, badge: 'PAIN RELIEF', segment: 'spa', includes: ['Trigger Point Pressure Therapy', 'Pain Relief Herbal Balms', 'Back, Neck & Shoulder Focus', 'Hot Compression'] },
  { id: 'pkg-prebridal-radiance', kind: 'package', title: 'Royal 7-Day Pre-Bridal Glow Package', group: 'bridal', section: 'Bridal & Makeup', minutes: 180, price: 3499, originalPrice: 5999, rating: 4.97, reviewsCount: 4200, badge: 'BRIDAL SPECIAL', segment: 'bridal', includes: ['Full Body Rica Waxing', 'O3+ Meladerm Luxury Bridal Facial', 'Full Body Bleach & Detan', 'Luxury Deluxe Mani-Pedi', 'Botoplex Hair Spa'] },
  { id: 'wax-rica-full-arms', kind: 'service', title: 'Rica Full Arms Wax', group: 'waxing', section: 'Waxing', minutes: 30, price: 449, originalPrice: 650, rating: 4.8, includes: ['Rica chocolate wax', 'Soothing pre & post wax gel'] },
  { id: 'wax-rica-full-legs', kind: 'service', title: 'Rica Full Legs Wax', group: 'waxing', section: 'Waxing', minutes: 40, price: 549, originalPrice: 750, rating: 4.8, includes: ['Rica chocolate wax', 'Smooth post-oil cleanse'] },
  { id: 'wax-underarms', kind: 'service', title: 'Underarms Wax', group: 'waxing', section: 'Waxing', minutes: 15, price: 149, originalPrice: 250, rating: 4.9, includes: ['Gentle Rica or honey wax'] },
  { id: 'wax-bikini', kind: 'service', title: 'Bikini Wax (Painless Peel-off)', group: 'waxing', section: 'Waxing', minutes: 35, price: 799, originalPrice: 1299, rating: 4.9, includes: ['Brazilian peel-off wax', '100% hygienic disposable kit'] },
  { id: 'wax-full-body', kind: 'service', title: 'Full Body Waxing (Rica)', group: 'waxing', section: 'Waxing', minutes: 90, price: 1499, originalPrice: 2499, rating: 4.93, includes: ['Full Arms', 'Full Legs', 'Underarms', 'Stomach & Back'] },
  { id: 'facial-o3', kind: 'service', title: 'O3+ Bridal Glow Facial', group: 'facial', section: 'Facial & cleanup', minutes: 60, price: 1499, originalPrice: 2200, rating: 4.9, includes: ['O3+ whitening mono-dose pack', 'Derma peel', 'Gold glow mask'] },
  { id: 'facial-hydra', kind: 'service', title: 'Hydra Pore Vacuum Facial', group: 'facial', section: 'Facial & cleanup', minutes: 50, price: 999, originalPrice: 1699, rating: 4.85, includes: ['Deep vacuum extraction', 'Hydra serum infusion', 'Cold jade roller massage'] },
  { id: 'facial-lotus', kind: 'service', title: 'Lotus Radiant Glow Facial', group: 'facial', section: 'Facial & cleanup', minutes: 50, price: 799, originalPrice: 1200, rating: 4.8, includes: ['Deep cleansing', 'Herbal scrub', 'Hydrating pack'] },
  { id: 'facial-cleanup', kind: 'service', title: 'Express Herbal Face Cleanup', group: 'facial', section: 'Facial & cleanup', minutes: 35, price: 449, originalPrice: 650, rating: 4.75, includes: ['Steam & blackhead removal', 'Face detan massage', 'Soothing pack'] },
  { id: 'pedi-rose', kind: 'service', title: 'Rose Petal Luxury Pedicure', group: 'manipedi', section: 'Manicure & Pedicure', minutes: 45, price: 599, originalPrice: 899, rating: 4.9, includes: ['Warm rose water soak', 'Dead skin exfoliation', 'Cuticle care', 'Relaxing foot massage'] },
  { id: 'mani-deluxe', kind: 'service', title: 'Deluxe Brightening Manicure', group: 'manipedi', section: 'Manicure & Pedicure', minutes: 40, price: 499, originalPrice: 750, rating: 4.85, includes: ['Nail shaping', 'Cuticle trimming', 'Whitening mask', 'Hand massage'] },
  { id: 'gel-nail-art', kind: 'service', title: 'Gel Polish & Nail Art', group: 'manipedi', section: 'Manicure & Pedicure', minutes: 60, price: 899, originalPrice: 1399, rating: 4.92, includes: ['UV gel polish', 'High gloss top coat', 'Custom 2-nail art'] },
  { id: 'hair-botoplex', kind: 'service', title: 'Botoplex Hair Restructuring Spa', group: 'hair', section: 'Hair Studio', minutes: 60, price: 1199, originalPrice: 1899, rating: 4.9, includes: ['Deep moisture bond repair', 'Steam infusion', 'Blow-dry finish'] },
  { id: 'hair-loreal-spa', kind: 'service', title: "L'Oreal Professional Hair Spa", group: 'hair', section: 'Hair Studio', minutes: 50, price: 899, originalPrice: 1399, rating: 4.82, includes: ["L'Oreal deep nourishing cream", 'Acupressure head massage', 'Steam & wash'] },
  { id: 'hair-root-touchup', kind: 'service', title: 'Root Touch-up (Ammonia Free)', group: 'hair', section: 'Hair Studio', minutes: 45, price: 699, originalPrice: 1099, rating: 4.8, includes: ['100% Grey coverage', 'Organic ammonia-free color', 'Post wash serum'] },
  { id: 'eyebrow', kind: 'service', title: 'Eyebrow Threading', group: 'quick', section: 'Threading', minutes: 15, price: 79, originalPrice: 120, rating: 4.9, includes: ['Organic cotton thread', 'Aloe soothing gel'] },
  { id: 'upper-lip', kind: 'service', title: 'Upper Lip Threading', group: 'quick', section: 'Threading', minutes: 10, price: 49, originalPrice: 80, rating: 4.85, includes: ['Upper lip threading', 'Rose water cooling'] },
  { id: 'detan-face', kind: 'service', title: 'Raaga Express Face Detan', group: 'facial', section: 'Bleach & detan', minutes: 25, price: 399, originalPrice: 600, rating: 4.88, includes: ['Raaga professional kojic acid pack', 'Sun tan removal'] },
  { id: 'men-combo', kind: 'service', title: "Men's Haircut + Beard Grooming + Detan", group: 'men', section: "Men's Grooming", minutes: 50, price: 499, originalPrice: 899, rating: 4.9, segment: 'men', includes: ['Precision haircut', 'Beard shaping & styling', 'Charcoal detan mask'] },
  { id: 'men-facial', kind: 'service', title: "Men's Charcoal Detox Facial", group: 'men', section: "Men's Grooming", minutes: 40, price: 599, originalPrice: 999, rating: 4.85, segment: 'men', includes: ['Blackhead removal', 'Charcoal mask', 'Face massage'] },
];
