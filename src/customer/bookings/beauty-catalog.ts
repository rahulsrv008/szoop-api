export type BeautyService = {
  id: string;
  title: string;
  minutes: number;
  price: number;
  includes: string[];
};

/** Prices are the source of truth for Beauty at Home bookings. */
export const BEAUTY_SERVICES: BeautyService[] = [
  { id: 'pkg-quick', title: 'Quick Grooming', minutes: 45, price: 199, includes: ['Eyebrow', 'Upper lip', 'Chin', 'Basic face cleanup'] },
  { id: 'pkg-glow', title: 'Monthly Glow', minutes: 80, price: 699, includes: ['Eyebrow + upper lip', 'Face cleanup', 'Detan', 'Head massage'] },
  { id: 'pkg-wax', title: 'Wax & Glow', minutes: 100, price: 899, includes: ['Full arms', 'Full legs', 'Underarms', 'Eyebrow + upper lip'] },
  { id: 'pkg-care', title: 'Monthly Beauty Care', minutes: 150, price: 1299, includes: ['Full arms + legs waxing', 'Facial / cleanup', 'Eyebrow + upper lip', 'Manicure or pedicure'] },
  { id: 'pkg-festival', title: 'Family / Festival', minutes: 180, price: 1999, includes: ['Waxing', 'Facial', 'Mani-pedi', 'Threading', 'Hair spa or head massage'] },
  { id: 'eyebrow', title: 'Eyebrow', minutes: 15, price: 79, includes: ['Eyebrow threading'] },
  { id: 'upper-lip', title: 'Upper lip', minutes: 10, price: 49, includes: ['Upper lip threading'] },
  { id: 'chin', title: 'Chin', minutes: 10, price: 49, includes: ['Chin threading'] },
  { id: 'full-arms', title: 'Full arms', minutes: 30, price: 349, includes: ['Full arms wax'] },
  { id: 'full-legs', title: 'Full legs', minutes: 40, price: 449, includes: ['Full legs wax'] },
  { id: 'underarms', title: 'Underarms', minutes: 15, price: 149, includes: ['Underarm wax'] },
  { id: 'half-legs', title: 'Half legs', minutes: 25, price: 299, includes: ['Half legs wax'] },
  { id: 'cleanup', title: 'Basic cleanup', minutes: 40, price: 399, includes: ['Basic face cleanup'] },
  { id: 'fruit-facial', title: 'Fruit facial', minutes: 50, price: 599, includes: ['Fruit facial'] },
  { id: 'glow-facial', title: 'Glow facial', minutes: 60, price: 799, includes: ['Glow facial'] },
  { id: 'detan', title: 'Detan', minutes: 35, price: 449, includes: ['Face detan'] },
  { id: 'bleach', title: 'Face & neck bleach', minutes: 25, price: 349, includes: ['Face and neck bleach'] },
  { id: 'mani-basic', title: 'Basic manicure', minutes: 30, price: 349, includes: ['Basic manicure'] },
  { id: 'mani-deluxe', title: 'Deluxe manicure', minutes: 45, price: 599, includes: ['Deluxe manicure'] },
  { id: 'pedi-basic', title: 'Basic pedicure', minutes: 40, price: 399, includes: ['Basic pedicure'] },
  { id: 'pedi-deluxe', title: 'Deluxe pedicure', minutes: 55, price: 699, includes: ['Deluxe pedicure'] },
  { id: 'haircut', title: 'Haircut', minutes: 30, price: 249, includes: ['Haircut'] },
  { id: 'head-massage', title: 'Head massage', minutes: 30, price: 349, includes: ['Head massage'] },
  { id: 'hair-spa', title: 'Hair spa', minutes: 60, price: 899, includes: ['Hair spa'] },
  { id: 'blow-dry', title: 'Blow-dry', minutes: 30, price: 399, includes: ['Blow-dry'] },
  { id: 'party-makeup', title: 'Party makeup', minutes: 60, price: 999, includes: ['Party makeup'] },
  { id: 'engagement-makeup', title: 'Engagement makeup', minutes: 90, price: 1999, includes: ['Engagement makeup'] },
  { id: 'wedding-makeup', title: 'Wedding makeup', minutes: 150, price: 3499, includes: ['Wedding makeup'] },
  { id: 'nail-paint', title: 'Nail paint', minutes: 20, price: 199, includes: ['Nail paint'] },
  { id: 'gel-nails', title: 'Gel / nail extensions', minutes: 75, price: 1499, includes: ['Gel polish or nail extensions'] },
];

export function findBeautyService(id: string) {
  return BEAUTY_SERVICES.find((service) => service.id === id);
}
