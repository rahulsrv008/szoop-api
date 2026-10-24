const { Client } = require('pg');

const client = new Client({
  host: 'pg-95ebf53-rahul-c17c.i.aivencloud.com',
  port: 27901,
  user: 'avnadmin',
  password: 'AVNS_8gdOA0ZZR17Q4qk3yVS',
  database: 'defaultdb',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  await client.connect();
  console.log('Connected to DB');

  await client.query(`
    UPDATE home_categories
    SET title = 'Salon at Home',
        subtitle = 'Salon & spa by verified beauty experts',
        badge = 'PREMIUM',
        tile_color = '#F3E8FF',
        layout = 'HALF',
        action_type = 'OPTIONS',
        popup_title = 'Salon & Spa at Home',
        is_active = true,
        highlights = $1::jsonb
    WHERE id = 'a1a00000-0000-4000-8000-000000000003'
  `, [
    JSON.stringify([
      { text: '100% mess-free single-use hygienic kits', icon: 'shield-checkmark' },
      { text: 'Top-rated, certified women beauty experts', icon: 'star' },
      { text: "Premium salon products (L'Oreal, Cheryl's, O3+)", icon: 'sparkles' },
      { text: 'Complete post-service cleanup & sanitisation', icon: 'checkmark-circle' }
    ])
  ]);
  console.log('Updated category a1a00000-0000-4000-8000-000000000003');

  const options = [
    {
      id: 'b3b00000-0000-4000-8000-000000000001',
      title: 'Quick Grooming',
      subtitle: 'Brows, upper lip, chin & face cleanup',
      price_label: 'from ₹199',
      badge: 'POPULAR',
      popup_title: 'What your beauty expert will do',
      highlights: JSON.stringify([
        { text: 'Eyebrow, upper lip & chin threading', icon: 'sparkles' },
        { text: 'Gentle face cleanup & organic detan pack', icon: 'leaf' },
        { text: 'Single-use disposable hygienic kit', icon: 'shield-checkmark' },
        { text: 'Post-service soothing face aloe gel', icon: 'water' }
      ]),
      pricing: JSON.stringify([
        { label: 'Express (30m)', subtitle: 'Eyebrow + Upper Lip', minutes: 30, startTime: null, price: 199 },
        { label: 'Standard (45m)', subtitle: 'Threading + Cleanup', minutes: 45, startTime: null, price: 299 },
        { label: 'Glow (60m)', subtitle: 'Threading + Detan Cleanup', minutes: 60, startTime: null, price: 449 }
      ]),
      sort_order: 1
    },
    {
      id: 'b3b00000-0000-4000-8000-000000000002',
      title: 'Waxing & Detan',
      subtitle: 'Arms, legs & underarms smooth waxing',
      price_label: 'from ₹299',
      badge: 'BESTSELLER',
      popup_title: 'What your beauty expert will do',
      highlights: JSON.stringify([
        { text: 'Full arms & full legs smooth waxing', icon: 'leaf' },
        { text: 'Underarm waxing with soothing gel', icon: 'water' },
        { text: 'Gentle honey & chocolate wax options', icon: 'sparkles' },
        { text: 'Disposable bedsheet & sanitised kit', icon: 'shield-checkmark' }
      ]),
      pricing: JSON.stringify([
        { label: 'Arms & Underarms (35m)', subtitle: null, minutes: 35, startTime: null, price: 299 },
        { label: 'Full Arms + Legs (60m)', subtitle: null, minutes: 60, startTime: null, price: 599 },
        { label: 'Full Body & Detan (90m)', subtitle: 'Complete wax + detan pack', minutes: 90, startTime: null, price: 899 }
      ]),
      sort_order: 2
    },
    {
      id: 'b3b00000-0000-4000-8000-000000000003',
      title: 'Facial & Cleanup',
      subtitle: 'Deep cleansing, exfoliation & gold glow',
      price_label: 'from ₹399',
      badge: 'TRENDING',
      popup_title: 'What your beauty expert will do',
      highlights: JSON.stringify([
        { text: 'Steam, blackhead removal & gentle scrub', icon: 'water' },
        { text: '15-min relaxing face & neck massage', icon: 'sparkles' },
        { text: 'Skin brightening detan mask', icon: 'sunny' },
        { text: "Cheryl's & O3+ certified skin packs", icon: 'star' }
      ]),
      pricing: JSON.stringify([
        { label: 'Basic Cleanup (40m)', subtitle: 'Cleanse + steam + scrub', minutes: 40, startTime: null, price: 399 },
        { label: 'Fruit Glow Facial (55m)', subtitle: 'Antioxidant fruit pack', minutes: 55, startTime: null, price: 599 },
        { label: 'Gold Radiance Facial (75m)', subtitle: 'Complete luxury glow treatment', minutes: 75, startTime: null, price: 799 }
      ]),
      sort_order: 3
    },
    {
      id: 'b3b00000-0000-4000-8000-000000000004',
      title: 'Hair Spa & Care',
      subtitle: 'Haircut, nourishing spa & head massage',
      price_label: 'from ₹249',
      badge: null,
      popup_title: 'What your beauty expert will do',
      highlights: JSON.stringify([
        { text: 'Warm oil scalp massage & pressure points', icon: 'heart' },
        { text: 'Deep conditioning hair spa & steam treatment', icon: 'water' },
        { text: 'Professional haircut & split-ends trim', icon: 'cut' },
        { text: 'Leave-in serum & blow-dry styling', icon: 'sparkles' }
      ]),
      pricing: JSON.stringify([
        { label: 'Haircut & Styling (30m)', subtitle: null, minutes: 30, startTime: null, price: 249 },
        { label: 'Scalp Massage & Steam (35m)', subtitle: null, minutes: 35, startTime: null, price: 349 },
        { label: "L'Oreal Hair Spa (60m)", subtitle: 'Spa cream bath + steam + blow-dry', minutes: 60, startTime: null, price: 899 }
      ]),
      sort_order: 4
    },
    {
      id: 'b3b00000-0000-4000-8000-000000000005',
      title: 'Manicure & Pedicure',
      subtitle: 'Rose soak, exfoliating scrub & massage',
      price_label: 'from ₹349',
      badge: null,
      popup_title: 'What your beauty expert will do',
      highlights: JSON.stringify([
        { text: 'Warm bubble soak & gentle cuticle care', icon: 'water' },
        { text: 'Dead skin removal & exfoliating scrub', icon: 'sparkles' },
        { text: 'Relaxing reflexology cream massage', icon: 'heart' },
        { text: 'Nail buffing, shaping & premium polish', icon: 'color-palette' }
      ]),
      pricing: JSON.stringify([
        { label: 'Classic Manicure (30m)', subtitle: null, minutes: 30, startTime: null, price: 349 },
        { label: 'Classic Pedicure (40m)', subtitle: null, minutes: 40, startTime: null, price: 399 },
        { label: 'Deluxe Mani + Pedi Combo (75m)', subtitle: 'Complete pamper session', minutes: 75, startTime: null, price: 699 }
      ]),
      sort_order: 5
    },
    {
      id: 'b3b00000-0000-4000-8000-000000000006',
      title: 'Party & Wedding Glam',
      subtitle: 'Professional makeup, saree drape & hair',
      price_label: 'from ₹999',
      badge: 'BEST VALUE',
      popup_title: 'What your beauty expert will do',
      highlights: JSON.stringify([
        { text: 'Flawless HD party or bridal makeup', icon: 'sparkles' },
        { text: 'Hairstyling (curls, buns, braids, blow-dry)', icon: 'cut' },
        { text: 'Saree / dupatta draping & pin-up', icon: 'shirt' },
        { text: 'Eyelashes & touch-up kit included', icon: 'star' }
      ]),
      pricing: JSON.stringify([
        { label: 'Party Makeup & Hair (60m)', subtitle: 'HD makeup + hairstyle', minutes: 60, startTime: null, price: 999 },
        { label: 'Engagement Glam (90m)', subtitle: 'Full glam + draping', minutes: 90, startTime: null, price: 1999 },
        { label: 'Bridal Makeup (150m)', subtitle: 'Luxury bridal HD glam', minutes: 150, startTime: null, price: 3499 }
      ]),
      sort_order: 6
    }
  ];

  for (const opt of options) {
    await client.query(`
      INSERT INTO home_category_options
        (id, category_id, title, subtitle, price_label, badge, popup_title, highlights, pricing, sort_order, is_active)
      VALUES
        ($1, 'a1a00000-0000-4000-8000-000000000003', $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, true)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        subtitle = EXCLUDED.subtitle,
        price_label = EXCLUDED.price_label,
        badge = EXCLUDED.badge,
        popup_title = EXCLUDED.popup_title,
        highlights = EXCLUDED.highlights,
        pricing = EXCLUDED.pricing,
        sort_order = EXCLUDED.sort_order,
        is_active = true
    `, [opt.id, opt.title, opt.subtitle, opt.price_label, opt.badge, opt.popup_title, opt.highlights, opt.pricing, opt.sort_order]);
    console.log('Seeded option:', opt.title);
  }

  // Also add a popular item for Salon
  await client.query(`
    INSERT INTO home_popular_items
      (id, title, subtitle, price_label, badge, rating, category_id, option_id, sort_order)
    VALUES
      ('c1c00000-0000-4000-8000-000000000004', 'Waxing & Detan · Full Body', 'Smooth waxing with soothing post-wax gel',
       '₹899', 'POPULAR', 4.9, 'a1a00000-0000-4000-8000-000000000003', 'b3b00000-0000-4000-8000-000000000002', 4)
    ON CONFLICT (id) DO UPDATE SET
      title = EXCLUDED.title,
      subtitle = EXCLUDED.subtitle,
      price_label = EXCLUDED.price_label,
      badge = EXCLUDED.badge,
      rating = EXCLUDED.rating
  `);
  console.log('Seeded popular item for Salon');

  await client.end();
  console.log('Done');
}

run().catch(err => {
  console.error('Error running seed:', err);
  process.exit(1);
});
