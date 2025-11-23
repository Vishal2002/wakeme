// src/services/train.service.ts
import { checkPNRStatus, trackTrain } from 'irctc-connect';
import type { TrainData } from '../types/index.js';

interface TrainStation {
  station: string;
  arr: string;
  dep: string;
  delay: string;
  distance: string;
  platform: string;
  status: 'completed' | 'current' | 'upcoming';
  current?: string;
}

interface LiveTrainStatus {
  currentStation: string;
  nextStation: string;
  stationsRemaining: number;
  distanceRemaining: number;
  delayMinutes: number;
  upcomingStations: TrainStation[];
}

export class TrainService {
  
  async fetchTrainData(pnr: string): Promise<TrainData | null> {
    try {
      console.log(`🔍 Fetching PNR: ${pnr}`);
      
      const result = await checkPNRStatus(pnr);
      
      if (!result.success || !result.data) {
        console.log('❌ Could not fetch PNR:', result.error);
        return null;
      }

      const data = result.data;
      
      console.log('✅ PNR Status:', data.status);
      console.log('✅ Train:', data.train.name, '(', data.train.number, ')');
      console.log('✅ Route:', data.journey.from.name, '→', data.journey.to.name);
      
      // ✅ Parse ISO date strings directly
      const departure = new Date(data.journey.departure); // "2025-11-23T19:45:00"
      const arrival = new Date(data.journey.arrival);     // "2025-11-24T10:40:00"
      
      console.log('✅ Departure:', departure.toISOString());
      console.log('✅ Arrival:', arrival.toISOString());
      
      const trainData: TrainData = {
        pnr: data.pnr,
        train_number: data.train.number,
        train_name: data.train.name,
        from: data.journey.from.name,
        to: data.journey.to.name,
        departure: departure,
        arrival: arrival
      };
      
      console.log('✅ Train data parsed successfully');
      
      return trainData;
      
    } catch (error) {
      console.error('❌ Train service error:', error);
      console.error('Stack:', (error as Error).stack);
      return null;
    }
  }

  async getLiveTrainStatus(
    trainNumber: string, 
    date: string, // dd-mm-yyyy format
    destinationStation: string
  ): Promise<LiveTrainStatus | null> {
    try {
      console.log(`🔍 Tracking train ${trainNumber} on ${date}`);
      
      const result = await trackTrain(trainNumber, date);
      
      if (!result.success || !result.data) {
        console.log('❌ Could not track train:', result.error);
        return null;
      }

      const stations: TrainStation[] = result.data;
      
      // Find current station
      const currentStation = stations.find(s => s.current === "true");
      if (!currentStation) {
        console.log('⚠️ Train not started yet or no current location');
        return null;
      }

      // Find destination index
      const destinationIndex = stations.findIndex(s => 
        s.station.toLowerCase().includes(destinationStation.toLowerCase())
      );

      if (destinationIndex === -1) {
        console.log('⚠️ Destination not found in route');
        return null;
      }

      const currentIndex = stations.indexOf(currentStation);
      
      // Get upcoming stations
      const upcomingStations = stations
        .slice(currentIndex + 1, destinationIndex + 1)
        .filter(s => s.status === 'upcoming');

      // Calculate remaining distance
      let distanceRemaining = 0;
      for (let i = currentIndex; i <= destinationIndex; i++) {
        const distance = parseInt(stations[i]?.distance || '0');
        if (!isNaN(distance)) {
          distanceRemaining += distance;
        }
      }

      // Parse delay
      const delayString = currentStation.delay || "On Time";
      const delayMatch = delayString.match(/\+?(\d+)/);
      const delayMinutes = delayMatch ? parseInt(delayMatch[1]) : 0;

      const nextStation = upcomingStations[0]?.station || 'Destination';

      console.log(`✅ Current: ${currentStation.station}, Next: ${nextStation}`);
      console.log(`✅ ${upcomingStations.length} stations remaining, ~${distanceRemaining}km`);

      return {
        currentStation: currentStation.station,
        nextStation: nextStation,
        stationsRemaining: upcomingStations.length,
        distanceRemaining: distanceRemaining,
        delayMinutes: delayMinutes,
        upcomingStations: upcomingStations
      };
      
    } catch (error) {
      console.error('❌ Train tracking error:', error);
      return null;
    }
  }

  formatDateForAPI(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  }
}

export const trainService = new TrainService();