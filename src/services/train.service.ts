import { checkPNRStatus, getTrainInfo, trackTrain } from 'irctc-connect';
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
      
      // Using checkPNRStatus from irctc-connect
      const result = await checkPNRStatus(pnr);
      
      if (!result.success || !result.data) {
        console.log('❌ Invalid PNR or error:', result.error);
        return null;
      }

      const pnrData = result.data;
      console.log('✅ PNR Data received:', pnrData);

      // Parse dates from PNR data
      const journeyDate = pnrData.journey.dateOfJourney; // Format: "dd-mm-yyyy"
      const [day, month, year] = journeyDate.split('-');
      
      // Get train departure and arrival times
      const depTime = pnrData.train.departureTime || '00:00';
      const arrTime = pnrData.train.arrivalTime || '23:59';
      
      const trainData: TrainData = {
        pnr: pnr,
        train_number: pnrData.train.number,
        train_name: pnrData.train.name,
        from: pnrData.journey.from.name,
        to: pnrData.journey.to.name,
        departure: new Date(`${year}-${month}-${day}T${depTime}:00`),
        arrival: new Date(`${year}-${month}-${day}T${arrTime}:00`)
      };
      
      return trainData;
      
    } catch (error) {
      console.error('❌ Train service error:', error);
      return null;
    }
  }

  async getLiveTrainStatus(
    trainNumber: string, 
    date: string, // dd-mm-yyyy format
    destinationStation: string
  ): Promise<LiveTrainStatus | null> {
    try {
      console.log(`🔍 Tracking train ${trainNumber} on ${date} to ${destinationStation}`);
      
      // Using trackTrain from irctc-connect
      const result = await trackTrain(trainNumber, date);
      
      if (!result.success || !result.data) {
        console.log('❌ Could not track train:', result.error);
        return null;
      }

      const stations: TrainStation[] = result.data;
      
      // Find current station (where current === "true")
      const currentStation = stations.find(s => s.current === "true");
      if (!currentStation) {
        console.log('⚠️ Could not determine current station - train may not have started');
        return null;
      }

      // Find destination station index
      const destinationIndex = stations.findIndex(s => 
        s.station.toLowerCase().includes(destinationStation.toLowerCase())
      );

      if (destinationIndex === -1) {
        console.log('⚠️ Destination not found in route');
        return null;
      }

      const currentIndex = stations.indexOf(currentStation);
      
      // Get upcoming stations until destination
      const upcomingStations = stations
        .slice(currentIndex + 1, destinationIndex + 1)
        .filter(s => s.status === 'upcoming');

      // Calculate distance remaining
      let distanceRemaining = 0;
      for (let i = currentIndex; i <= destinationIndex; i++) {
        const distance = parseInt(stations[i]?.distance || '0');
        if (!isNaN(distance)) {
          distanceRemaining += distance;
        }
      }

      // Parse delay (format: "+10 min", "On Time", etc.)
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
