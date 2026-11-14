import type { AiraItemKind, AiraSegment } from 'src/database/entities';

/** The Aira Luxury menu as it shipped in the app; loaded once into an empty database. */
/** The Aira Luxury menu as it shipped in the app; loaded once into an empty database. */
export const SEED_GROUPS: {
  id: string;
  title: string;
  blurb: string;
  icon: string;
  segment: AiraSegment;
  imageUrl?: string;
}[] = [
  { id: 'monthly', title: 'Packages', icon: 'calendar', blurb: 'Most booked monthly head-to-toe packages', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80' },
  { id: 'waxing', title: 'Waxing', icon: 'leaf', blurb: 'Rica, honey, roll-on and painless wax', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&w=800&q=80' },
  { id: 'facial', title: 'Facial', icon: 'sparkles', blurb: 'Hydra facial, O3+, cleanups and detan', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80' },
  { id: 'manipedi', title: 'Mani-Pedi', icon: 'flower', blurb: 'Rose petal pedicure, gel nails and mani', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=800&q=80' },
  { id: 'hair', title: 'Hair Studio', icon: 'cut', blurb: 'Botoplex, hair spa, color and blowdry', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=800&q=80' },
  { id: 'spa', title: 'Body Spa & Relax', icon: 'heart', blurb: 'Swedish, deep tissue & aroma therapy at home', segment: 'spa', imageUrl: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=800&q=80' },
  { id: 'bridal', title: 'Bridal & Pre-Bridal', icon: 'diamond', blurb: 'Royal 7-day bridal glow and makeup', segment: 'bridal', imageUrl: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80' },
  { id: 'quick', title: 'Threading & Face', icon: 'flash', blurb: 'Brows, upper lip, chin and touch-ups', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1588515724527-074a7a56616c?auto=format&fit=crop&w=800&q=80' },
  { id: 'men', title: "Men's Grooming", icon: 'man', blurb: 'Haircut, beard trim, detan and facial', segment: 'men', imageUrl: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80' },
];

/** Menu headings in the order the app lists them. */
export const SEED_SECTIONS = [
  'Value Combos',
  'Packages',
  'Top Selling',
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
  imageUrl?: string;
};

export const SEED_ITEMS: SeedItem[] = [
  // --- YES MADAM SCREENSHOT SHOWCASES ---
  {
    id: 'pkg-korean-glow-special',
    kind: 'package',
    title: 'Korean Glow Special',
    group: 'monthly',
    section: 'Packages',
    minutes: 272,
    price: 3125,
    originalPrice: 6246,
    rating: 4.96,
    reviewsCount: 42800,
    badge: '49% OFF',
    segment: 'women',
    imageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80',
    includes: [
      'Waxing: Full Arms, Full Legs & Underarms (Korean Waxing Ritual)',
      'Premium Facial: Korean Glow Facial (Korean Glow Facial)',
      'Manicure & Pedicure: Mani-Pedi Combo (Korean Luxe Mani & Pedi)',
      'Facial Hair Removal: Eyebrows (Threading)',
    ],
  },
  {
    id: 'pkg-korean-wax-glow',
    kind: 'package',
    title: 'Korean Wax & Glow',
    group: 'waxing',
    section: 'Packages',
    minutes: 150,
    price: 2199,
    originalPrice: 3999,
    rating: 4.93,
    reviewsCount: 31200,
    badge: '45% OFF',
    segment: 'women',
    imageUrl: 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&w=800&q=80',
    includes: [
      'Waxing: Full Arms & Legs (Korean Ritual)',
      'Facial: Korean Instant Glass Glow',
      'Underarms Waxing',
      'Eyebrow Threading',
    ],
  },
  {
    id: 'facial-korean-glow',
    kind: 'service',
    title: 'Korean Glow Facial',
    group: 'facial',
    section: 'Top Selling',
    minutes: 75,
    price: 1299,
    originalPrice: 2499,
    rating: 4.91,
    reviewsCount: 202712,
    badge: '48% OFF',
    segment: 'women',
    imageUrl: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80',
    includes: [
      '10 Steps | FREE Cleansing Brush & Lip Balm',
      'Brightens | Hydrates | Nourishes',
      'Rice Extract Infusion',
      'All Skin Types Suitable',
    ],
  },

  // --- BESTSELLER PACKAGES ---
  { id: 'pkg-complete-glow', kind: 'package', title: 'Complete Monthly Grooming Combo', group: 'monthly', section: 'Value Combos', minutes: 90, price: 999, originalPrice: 1899, rating: 4.9, reviewsCount: 18400, badge: 'BESTSELLER', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1512290900672-1f55b9e73522?auto=format&fit=crop&w=800&q=80', includes: ['Full Arms + Full Legs Waxing', 'Underarms Honey Wax', 'O3+ Face Detan', 'Lotus Face Cleanup', 'Eyebrow + Upper Lip'] },
  { id: 'pkg-rica-lux', kind: 'package', title: 'Rica Roll-on Luxury Pampering', group: 'waxing', section: 'Value Combos', minutes: 110, price: 1399, originalPrice: 2499, rating: 4.95, reviewsCount: 12200, badge: 'SAVE 44%', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=800&q=80', includes: ['Rica White Chocolate Wax (Arms & Legs)', 'Underarms Wax', 'Sara Herbal D-Tan', 'Rose Petal Classic Pedicure', 'Threading'] },
  { id: 'pkg-hydra-facial-luxe', kind: 'package', title: 'Hydra-Glow Deluxe Facial + Head Spa', group: 'facial', section: 'Value Combos', minutes: 75, price: 1299, originalPrice: 2200, rating: 4.88, reviewsCount: 9600, badge: 'TRENDING', segment: 'women', imageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', includes: ['Hydra Vacuum Pore Cleansing', 'Hyaluronic Acid Serum Infusion', 'Face Detan Pack', '20-min Relaxing Head Massage'] },
  { id: 'pkg-full-body-spa', kind: 'package', title: 'Royal Full Body Swedish Spa & Aroma Massage', group: 'spa', section: 'Spa & Massage', minutes: 60, price: 1199, originalPrice: 1999, rating: 4.92, reviewsCount: 7800, badge: 'LUXURY', segment: 'spa', imageUrl: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=800&q=80', includes: ['60-Min Swedish Body Massage', 'Warm Sesame & Lavender Oil', 'Hot Towel Wrap', 'Zero Mess Disposable Sheet Setup'] },
  { id: 'pkg-deep-tissue', kind: 'package', title: 'Deep Tissue Pain Relief Massage', group: 'spa', section: 'Spa & Massage', minutes: 60, price: 1299, originalPrice: 2199, rating: 4.87, reviewsCount: 5400, badge: 'PAIN RELIEF', segment: 'spa', imageUrl: 'https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=800&q=80', includes: ['Trigger Point Pressure Therapy', 'Pain Relief Herbal Balms', 'Back, Neck & Shoulder Focus', 'Hot Compression'] },
  { id: 'pkg-prebridal-radiance', kind: 'package', title: 'Royal 7-Day Pre-Bridal Glow Package', group: 'bridal', section: 'Bridal & Makeup', minutes: 180, price: 3499, originalPrice: 5999, rating: 4.97, reviewsCount: 4200, badge: 'BRIDAL SPECIAL', segment: 'bridal', imageUrl: 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=800&q=80', includes: ['Full Body Rica Waxing', 'O3+ Meladerm Luxury Bridal Facial', 'Full Body Bleach & Detan', 'Luxury Deluxe Mani-Pedi', 'Botoplex Hair Spa'] },

  // --- WAXING SERVICES ---
  { id: 'wax-rica-full-arms', kind: 'service', title: 'Rica Full Arms Wax', group: 'waxing', section: 'Waxing', minutes: 30, price: 449, originalPrice: 650, rating: 4.8, reviewsCount: 15400, imageUrl: 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&w=800&q=80', includes: ['Rica chocolate wax', 'Soothing pre & post wax gel'] },
  { id: 'wax-rica-full-legs', kind: 'service', title: 'Rica Full Legs Wax', group: 'waxing', section: 'Waxing', minutes: 40, price: 549, originalPrice: 750, rating: 4.8, reviewsCount: 18200, imageUrl: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=800&q=80', includes: ['Rica chocolate wax', 'Smooth post-oil cleanse'] },
  { id: 'wax-underarms', kind: 'service', title: 'Underarms Wax', group: 'waxing', section: 'Waxing', minutes: 15, price: 149, originalPrice: 250, rating: 4.9, reviewsCount: 22400, imageUrl: 'https://images.unsplash.com/photo-1560750588-73207b1ef5b8?auto=format&fit=crop&w=800&q=80', includes: ['Gentle Rica or honey wax'] },
  { id: 'wax-bikini', kind: 'service', title: 'Bikini Wax (Painless Peel-off)', group: 'waxing', section: 'Waxing', minutes: 35, price: 799, originalPrice: 1299, rating: 4.9, reviewsCount: 9400, imageUrl: 'https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=800&q=80', includes: ['Brazilian peel-off wax', '100% hygienic disposable kit'] },
  { id: 'wax-full-body', kind: 'service', title: 'Full Body Waxing (Rica)', group: 'waxing', section: 'Waxing', minutes: 90, price: 1499, originalPrice: 2499, rating: 4.93, reviewsCount: 11500, imageUrl: 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=800&q=80', includes: ['Full Arms', 'Full Legs', 'Underarms', 'Stomach & Back'] },

  // --- FACIALS & CLEANUPS ---
  { id: 'facial-o3', kind: 'service', title: 'O3+ Bridal Glow Facial', group: 'facial', section: 'Facial & cleanup', minutes: 60, price: 1499, originalPrice: 2200, rating: 4.9, reviewsCount: 38200, imageUrl: 'https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=800&q=80', includes: ['O3+ whitening mono-dose pack', 'Derma peel', 'Gold glow mask'] },
  { id: 'facial-hydra', kind: 'service', title: 'Hydra Pore Vacuum Facial', group: 'facial', section: 'Facial & cleanup', minutes: 50, price: 999, originalPrice: 1699, rating: 4.85, reviewsCount: 29500, imageUrl: 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=800&q=80', includes: ['Deep vacuum extraction', 'Hydra serum infusion', 'Cold jade roller massage'] },
  { id: 'facial-lotus', kind: 'service', title: 'Lotus Radiant Glow Facial', group: 'facial', section: 'Facial & cleanup', minutes: 50, price: 799, originalPrice: 1200, rating: 4.8, reviewsCount: 16400, imageUrl: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=800&q=80', includes: ['Deep cleansing', 'Herbal scrub', 'Hydrating pack'] },
  { id: 'facial-cleanup', kind: 'service', title: 'Express Herbal Face Cleanup', group: 'facial', section: 'Facial & cleanup', minutes: 35, price: 449, originalPrice: 650, rating: 4.75, reviewsCount: 14200, imageUrl: 'https://images.unsplash.com/photo-1512290900672-1f55b9e73522?auto=format&fit=crop&w=800&q=80', includes: ['Steam & blackhead removal', 'Face detan massage', 'Soothing pack'] },

  // --- MANICURE & PEDICURE ---
  { id: 'pedi-rose', kind: 'service', title: 'Rose Petal Luxury Pedicure', group: 'manipedi', section: 'Manicure & Pedicure', minutes: 45, price: 599, originalPrice: 899, rating: 4.9, reviewsCount: 21300, imageUrl: 'https://images.unsplash.com/photo-1519014816548-bf5fe059798b?auto=format&fit=crop&w=800&q=80', includes: ['Warm rose water soak', 'Dead skin exfoliation', 'Cuticle care', 'Relaxing foot massage'] },
  { id: 'mani-deluxe', kind: 'service', title: 'Deluxe Brightening Manicure', group: 'manipedi', section: 'Manicure & Pedicure', minutes: 40, price: 499, originalPrice: 750, rating: 4.85, reviewsCount: 17800, imageUrl: 'https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=800&q=80', includes: ['Nail shaping', 'Cuticle trimming', 'Whitening mask', 'Hand massage'] },
  { id: 'gel-nail-art', kind: 'service', title: 'Gel Polish & Nail Art', group: 'manipedi', section: 'Manicure & Pedicure', minutes: 60, price: 899, originalPrice: 1399, rating: 4.92, reviewsCount: 12500, imageUrl: 'https://images.unsplash.com/photo-1632345031435-8727f6897d53?auto=format&fit=crop&w=800&q=80', includes: ['UV gel polish', 'High gloss top coat', 'Custom 2-nail art'] },

  // --- HAIR STUDIO ---
  { id: 'hair-botoplex', kind: 'service', title: 'Botoplex Hair Restructuring Spa', group: 'hair', section: 'Hair Studio', minutes: 60, price: 1199, originalPrice: 1899, rating: 4.9, reviewsCount: 19800, imageUrl: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=800&q=80', includes: ['Deep moisture bond repair', 'Steam infusion', 'Blow-dry finish'] },
  { id: 'hair-loreal-spa', kind: 'service', title: "L'Oreal Professional Hair Spa", group: 'hair', section: 'Hair Studio', minutes: 50, price: 899, originalPrice: 1399, rating: 4.82, reviewsCount: 14700, imageUrl: 'https://images.unsplash.com/photo-1527799820374-dcf8d9d4a388?auto=format&fit=crop&w=800&q=80', includes: ["L'Oreal deep nourishing cream", 'Acupressure head massage', 'Steam & wash'] },
  { id: 'hair-root-touchup', kind: 'service', title: 'Root Touch-up (Ammonia Free)', group: 'hair', section: 'Hair Studio', minutes: 45, price: 699, originalPrice: 1099, rating: 4.8, reviewsCount: 8900, imageUrl: 'https://images.unsplash.com/photo-1562322140-8baeececf3df?auto=format&fit=crop&w=800&q=80', includes: ['100% Grey coverage', 'Organic ammonia-free color', 'Post wash serum'] },

  // --- THREADING & BLEACH ---
  { id: 'eyebrow', kind: 'service', title: 'Eyebrow Threading', group: 'quick', section: 'Threading', minutes: 15, price: 79, originalPrice: 120, rating: 4.9, reviewsCount: 54100, imageUrl: 'https://images.unsplash.com/photo-1588515724527-074a7a56616c?auto=format&fit=crop&w=800&q=80', includes: ['Organic cotton thread', 'Aloe soothing gel'] },
  { id: 'upper-lip', kind: 'service', title: 'Upper Lip Threading', group: 'quick', section: 'Threading', minutes: 10, price: 49, originalPrice: 80, rating: 4.85, reviewsCount: 46700, imageUrl: 'https://images.unsplash.com/photo-1588515724527-074a7a56616c?auto=format&fit=crop&w=800&q=80', includes: ['Upper lip threading', 'Rose water cooling'] },
  { id: 'detan-face', kind: 'service', title: 'Raaga Express Face Detan', group: 'facial', section: 'Bleach & detan', minutes: 25, price: 399, originalPrice: 600, rating: 4.88, reviewsCount: 33400, imageUrl: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=800&q=80', includes: ['Raaga professional kojic acid pack', 'Sun tan removal'] },

  // --- MEN'S GROOMING ---
  { id: 'men-combo', kind: 'service', title: "Men's Haircut + Beard Grooming + Detan", group: 'men', section: "Men's Grooming", minutes: 50, price: 499, originalPrice: 899, rating: 4.9, reviewsCount: 16900, segment: 'men', imageUrl: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=800&q=80', includes: ['Precision haircut', 'Beard shaping & styling', 'Charcoal detan mask'] },
  { id: 'men-facial', kind: 'service', title: "Men's Charcoal Detox Facial", group: 'men', section: "Men's Grooming", minutes: 40, price: 599, originalPrice: 999, rating: 4.85, reviewsCount: 11200, segment: 'men', imageUrl: 'https://images.unsplash.com/photo-1621605815971-fbc98d665033?auto=format&fit=crop&w=800&q=80', includes: ['Blackhead removal', 'Charcoal mask', 'Face massage'] },
];
