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
      
      // Detailed logging
      console.log('📦 API Response Success:', result.success);
      console.log('📦 API Response Data:', result.data ? 'Present' : 'Missing');
      console.log('📦 API Response Error:', result.error || 'None');
      
      if (!result.success) {
        console.log('❌ API call failed:', result.error);
        return null;
      }
      
      if (!result.data) {
        console.log('❌ No data in response');
        return null;
      }

      const data = result.data;
      
      // Log what we got
      console.log('✅ PNR:', data.pnr);
      console.log('✅ Status:', data.status);
      console.log('✅ Train Name:', data.train?.name);
      console.log('✅ Train Number:', data.train?.number);
      console.log('✅ From:', data.journey?.from?.name);
      console.log('✅ To:', data.journey?.to?.name);
      console.log('✅ Date:', data.journey?.dateOfJourney);
      
      // Extract data - exactly like your working index.js
      const journeyDate = data.journey.dateOfJourney; // "dd-mm-yyyy"
      const [day, month, year] = journeyDate.split('-');
      
      // Handle times - they might not exist in all responses
      const depTime = data.train.departureTime || data.journey.departureTime || '00:00';
      const arrTime = data.train.arrivalTime || data.journey.arrivalTime || '23:59';
      
      console.log('⏰ Departure Time:', depTime);
      console.log('⏰ Arrival Time:', arrTime);
      
      const trainData: TrainData = {
        pnr: data.pnr,
        train_number: data.train.number,
        train_name: data.train.name,
        from: data.journey.from.name,
        to: data.journey.to.name,
        departure: new Date(`${year}-${month}-${day}T${depTime}:00`),
        arrival: new Date(`${year}-${month}-${day}T${arrTime}:00`)
      };
      
      console.log('✅ Parsed TrainData:', JSON.stringify(trainData, null, 2));
      
      return trainData;
      
    } catch (error) {
      console.error('❌ Exception in fetchTrainData:', error);
      console.error('❌ Error name:', (error as Error).name);
      console.error('❌ Error message:', (error as Error).message);
      console.error('❌ Error stack:', (error as Error).stack);
      return null;
    }
  }

  async getLiveTrainStatus(
    trainNumber: string, 
    date: string,
    destinationStation: string
  ): Promise<LiveTrainStatus | null> {
    try {
      console.log(`🔍 Tracking train ${trainNumber} on ${date} to ${destinationStation}`);
      
      const result = await trackTrain(trainNumber, date);
      
      console.log('📦 Track API Success:', result.success);
      
      if (!result.success || !result.data) {
        console.log('❌ Could not track train:', result.error);
        return null;
      }

      const stations: TrainStation[] = result.data;
      
      const currentStation = stations.find(s => s.current === "true");
      if (!currentStation) {
        console.log('⚠️ Could not determine current station');
        return null;
      }

      const destinationIndex = stations.findIndex(s => 
        s.station.toLowerCase().includes(destinationStation.toLowerCase())
      );

      if (destinationIndex === -1) {
        console.log('⚠️ Destination not found in route');
        return null;
      }

      const currentIndex = stations.indexOf(currentStation);
      
      const upcomingStations = stations
        .slice(currentIndex + 1, destinationIndex + 1)
        .filter(s => s.status === 'upcoming');

      let distanceRemaining = 0;
      for (let i = currentIndex; i <= destinationIndex; i++) {
        const distance = parseInt(stations[i]?.distance || '0');
        if (!isNaN(distance)) {
          distanceRemaining += distance;
        }
      }

      const delayString = currentStation.delay || "On Time";
      const delayMatch = delayString.match(/\+?(\d+)/);
      const delayMinutes = delayMatch ? parseInt(delayMatch[1]) : 0;

      const nextStation = upcomingStations[0]?.station || 'Destination';

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