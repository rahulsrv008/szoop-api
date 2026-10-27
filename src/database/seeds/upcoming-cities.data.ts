export interface UpcomingCitySeed {
  city: string;
  nickname: string | null;
  state: string;
  aliases: string[];
  latitude: number;
  longitude: number;
  radiusKm: number;
}

/**
 * Cities we don't serve yet but want to greet by name ("We'll be available
 * soon in Taj City"). Seeded with ON CONFLICT DO NOTHING, so admin edits to
 * a row survive restarts.
 */
export const UPCOMING_CITIES: UpcomingCitySeed[] = [
  { city: 'Agra', nickname: 'Taj City', state: 'Uttar Pradesh', aliases: ['agra cantt', 'आगरा'], latitude: 27.1767, longitude: 78.0081, radiusKm: 30 },
  { city: 'Jaipur', nickname: 'Pink City', state: 'Rajasthan', aliases: ['जयपुर'], latitude: 26.9124, longitude: 75.7873, radiusKm: 35 },
  { city: 'Udaipur', nickname: 'City of Lakes', state: 'Rajasthan', aliases: ['उदयपुर'], latitude: 24.5854, longitude: 73.7125, radiusKm: 25 },
  { city: 'Jodhpur', nickname: 'Blue City', state: 'Rajasthan', aliases: ['जोधपुर'], latitude: 26.2389, longitude: 73.0243, radiusKm: 25 },
  { city: 'Lucknow', nickname: 'City of Nawabs', state: 'Uttar Pradesh', aliases: ['लखनऊ'], latitude: 26.8467, longitude: 80.9462, radiusKm: 35 },
  { city: 'Varanasi', nickname: 'City of Ghats', state: 'Uttar Pradesh', aliases: ['banaras', 'benares', 'kashi', 'वाराणसी'], latitude: 25.3176, longitude: 82.9739, radiusKm: 25 },
  { city: 'Kanpur', nickname: 'Manchester of the East', state: 'Uttar Pradesh', aliases: ['कानपुर'], latitude: 26.4499, longitude: 80.3319, radiusKm: 30 },
  { city: 'Mathura', nickname: 'Krishna Nagari', state: 'Uttar Pradesh', aliases: ['vrindavan', 'मथुरा'], latitude: 27.4924, longitude: 77.6737, radiusKm: 20 },
  { city: 'Chandigarh', nickname: 'City Beautiful', state: 'Chandigarh', aliases: ['mohali', 'panchkula', 'tricity'], latitude: 30.7333, longitude: 76.7794, radiusKm: 20 },
  { city: 'Amritsar', nickname: 'Golden City', state: 'Punjab', aliases: ['अमृतसर'], latitude: 31.634, longitude: 74.8723, radiusKm: 25 },
  { city: 'Dehradun', nickname: 'Doon Valley', state: 'Uttarakhand', aliases: ['देहरादून'], latitude: 30.3165, longitude: 78.0322, radiusKm: 25 },
  { city: 'Mumbai', nickname: 'City of Dreams', state: 'Maharashtra', aliases: ['bombay', 'navi mumbai', 'thane', 'मुंबई'], latitude: 19.076, longitude: 72.8777, radiusKm: 45 },
  { city: 'Pune', nickname: 'Queen of the Deccan', state: 'Maharashtra', aliases: ['pimpri-chinchwad', 'पुणे'], latitude: 18.5204, longitude: 73.8567, radiusKm: 35 },
  { city: 'Bengaluru', nickname: 'Garden City', state: 'Karnataka', aliases: ['bangalore', 'bengaluru urban'], latitude: 12.9716, longitude: 77.5946, radiusKm: 40 },
  { city: 'Hyderabad', nickname: 'City of Pearls', state: 'Telangana', aliases: ['secunderabad', 'cyberabad'], latitude: 17.385, longitude: 78.4867, radiusKm: 40 },
  { city: 'Chennai', nickname: 'Gateway to South India', state: 'Tamil Nadu', aliases: ['madras'], latitude: 13.0827, longitude: 80.2707, radiusKm: 40 },
  { city: 'Kolkata', nickname: 'City of Joy', state: 'West Bengal', aliases: ['calcutta', 'howrah'], latitude: 22.5726, longitude: 88.3639, radiusKm: 35 },
  { city: 'Ahmedabad', nickname: 'Manchester of India', state: 'Gujarat', aliases: ['amdavad', 'gandhinagar'], latitude: 23.0225, longitude: 72.5714, radiusKm: 35 },
  { city: 'Indore', nickname: 'Cleanest City', state: 'Madhya Pradesh', aliases: ['इंदौर'], latitude: 22.7196, longitude: 75.8577, radiusKm: 25 },
  { city: 'Bhopal', nickname: 'City of Lakes', state: 'Madhya Pradesh', aliases: ['भोपाल'], latitude: 23.2599, longitude: 77.4126, radiusKm: 25 },
];
