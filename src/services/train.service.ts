import axios from 'axios';
import { config } from '../config/env.js';
import type { TrainData } from '../types/index.js';

export class TrainService {
  async fetchTrainData(pnr: string): Promise<TrainData> {
    // If you have Railway API key
    if (config.RAILWAY_API_KEY) {
      try {
        const response = await axios.get(
          `https://api.railwayapi.site/api/v1/pnr-status/${pnr}`,
          {
            headers: { 'x-api-key': config.RAILWAY_API_KEY }
          }
        );
        
        return {
          pnr: pnr,
          train_number: response.data.train_number,
          train_name: response.data.train_name,
          from: response.data.from_station,
          to: response.data.to_station,
          departure: new Date(response.data.departure_time),
          arrival: new Date(response.data.arrival_time)
        };
      } catch (error) {
        console.error('Railway API error:', error);
      }
    }

    // Mock data fallback
    return {
      pnr: pnr,
      train_number: '12301',
      train_name: 'Rajdhani Express',
      from: 'New Delhi',
      to: 'Lucknow',
      departure: new Date(Date.now() + 2 * 60 * 60 * 1000),
      arrival: new Date(Date.now() + 10 * 60 * 60 * 1000)
    };
  }
}

export const trainService = new TrainService();
