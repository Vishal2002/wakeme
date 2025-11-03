import axios from 'axios';
import { config } from '../config/env.js';

export class LocationService {
  // Convert city name to lat/lng
  async geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
    if (!config.GOOGLE_MAPS_API_KEY) {
      console.log('⚠️ No Google Maps API key, using mock location');
      return this.getMockLocation(address);
    }

    try {
      const response = await axios.get(
        'https://maps.googleapis.com/maps/api/geocode/json',
        {
          params: {
            address: address,
            key: config.GOOGLE_MAPS_API_KEY,
            region: 'in' // Prefer Indian results
          }
        }
      );

      if (response.data.status === 'OK' && response.data.results.length > 0) {
        const location = response.data.results[0].geometry.location;
        console.log(`✅ Geocoded "${address}" to:`, location);
        return {
          lat: location.lat,
          lng: location.lng
        };
      }

      console.log(`❌ Geocoding failed for "${address}"`);
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      return null;
    }
  }

  // Fallback: Mock locations for common Indian cities
  private getMockLocation(city: string): { lat: number; lng: number } | null {
    const cityMap: Record<string, { lat: number; lng: number }> = {
      'mumbai': { lat: 19.0760, lng: 72.8777 },
      'delhi': { lat: 28.7041, lng: 77.1025 },
      'bangalore': { lat: 12.9716, lng: 77.5946 },
      'hyderabad': { lat: 17.3850, lng: 78.4867 },
      'chennai': { lat: 13.0827, lng: 80.2707 },
      'kolkata': { lat: 22.5726, lng: 88.3639 },
      'pune': { lat: 18.5204, lng: 73.8567 },
      'ahmedabad': { lat: 23.0225, lng: 72.5714 },
      'surat': { lat: 21.1702, lng: 72.8311 },
      'jaipur': { lat: 26.9124, lng: 75.7873 }
    };

    const normalizedCity = city.toLowerCase().trim();
    return cityMap[normalizedCity] || null;
  }

  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  calculateETA(distance: number, speed: number = 60): number {
    return Math.round((distance / speed) * 60);
  }
}

export const locationService = new LocationService();