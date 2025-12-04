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
      
      const departure = new Date(data.journey.departure);
      const arrival = new Date(data.journey.arrival);
      
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
      console.log('\n🔍 ===== LIVE TRAIN TRACKING =====');
      console.log(`📋 Train Number: ${trainNumber}`);
      console.log(`📅 Date: ${date}`);
      console.log(`🎯 Destination: ${destinationStation}`);
      
      const result = await trackTrain(trainNumber, date);
      
      console.log(`📡 API Response Success: ${result.success}`);
      
      if (!result.success) {
        console.log('❌ API Error:', result.error);
        return null;
      }
      
      if (!result.data) {
        console.log('❌ No data returned');
        return null;
      }

      const trackData = result.data;
      
      console.log(`✅ Train: ${trackData.trainName} (${trackData.trainNo})`);
      console.log(`📍 Status Note: ${trackData.statusNote}`);
      console.log(`🕐 Last Update: ${trackData.lastUpdate}`);
      console.log(`🛤️ Total Stations: ${trackData.totalStations}`);

      if (!trackData.stations || trackData.stations.length === 0) {
        console.log('❌ No station data available');
        return null;
      }

      // ✅ Convert irctc-connect format to our format
      const stations: TrainStation[] = trackData.stations.map((station: any) => {
        // Determine if station is completed, current, or upcoming
        let status: 'completed' | 'current' | 'upcoming' = 'upcoming';
        let isCurrent = false;

        const arrActual = station.arrival?.actual || '';
        const arrScheduled = station.arrival?.scheduled || '';
        const depActual = station.departure?.actual || '';
        const depScheduled = station.departure?.scheduled || '';

        // Station is COMPLETED if train has departed
        if (depActual && depActual !== 'SRC' && depActual !== '--:--' && !depActual.includes('--')) {
          status = 'completed';
        }
        // Station is CURRENT if train has arrived but not departed
        else if (arrActual && arrActual !== 'SRC' && arrActual !== '--:--' && !arrActual.includes('--')) {
          if (!depActual || depActual === 'SRC' || depActual === '--:--' || depActual.includes('--')) {
            status = 'current';
            isCurrent = true;
          }
        }
        // Otherwise UPCOMING

        // Parse distance (remove "km" suffix if present)
        const distanceStr = station.distanceKm?.toString().replace(/[^\d]/g, '') || '0';

        return {
          station: station.stationName || station.stationCode,
          arr: arrActual || arrScheduled || '--:--',
          dep: depActual || depScheduled || '--:--',
          delay: station.departure?.delay || station.arrival?.delay || 'On Time',
          distance: distanceStr,
          platform: station.platform || '',
          status: status,
          current: isCurrent ? 'true' : undefined
        };
      });

      console.log(`✅ Converted ${stations.length} stations`);
      
      // Debug: Show first few stations with their status
      console.log('\n📋 Station Status Check:');
      stations.slice(0, 5).forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.station} - Status: ${s.status}${s.current ? ' [CURRENT]' : ''}`);
        console.log(`      Arr: ${s.arr}, Dep: ${s.dep}, Delay: ${s.delay}`);
      });
      
      // Find current station
      let currentStation = stations.find(s => s.current === 'true');
      
      if (!currentStation) {
        console.log('⚠️ No current station found via status detection');
        
        // Try to extract from statusNote: "Departed from VADOD(VXD) at 23:16"
        if (trackData.statusNote) {
          const match = trackData.statusNote.match(/(?:Departed from|Arrived at|at)\s+([A-Z\s]+)\(([A-Z]+)\)/i);
          if (match) {
            const stationCode = match[2];
            console.log(`   Trying to find station from status: ${stationCode}`);
            
            // Find this station in our list
            const inferredStation = stations.find(s => 
              s.station.includes(stationCode) || 
              s.station.toLowerCase().includes(match[1].toLowerCase())
            );
            
            if (inferredStation) {
              console.log(`   ✅ Found station from status: ${inferredStation.station}`);
              currentStation = inferredStation;
            }
          }
        }
        
        if (!currentStation) {
          // Check if all stations are completed (journey finished)
          const allCompleted = stations.every(s => s.status === 'completed');
          if (allCompleted) {
            console.log('✅ Journey completed - train reached final destination');
          } else {
            console.log('⏳ Train hasn\'t started yet');
            console.log('   First 3 stations:', stations.slice(0, 3).map(s => s.station).join(', '));
          }
          
          return null;
        }
      }

      console.log(`📍 Current Station: ${currentStation.station}`);
      console.log(`   Arrival: ${currentStation.arr}`);
      console.log(`   Departure: ${currentStation.dep}`);
      console.log(`   Delay: ${currentStation.delay}`);

      // Find destination with improved matching
      const destinationLower = destinationStation.toLowerCase().trim();
      
      let destinationIndex = -1;
      
      // Try exact match
      destinationIndex = stations.findIndex(s => 
        s.station.toLowerCase().trim() === destinationLower
      );
      
      // Try contains match
      if (destinationIndex === -1) {
        destinationIndex = stations.findIndex(s => {
          const stationLower = s.station.toLowerCase().trim();
          return stationLower.includes(destinationLower) || 
                 destinationLower.includes(stationLower);
        });
      }
      
      // Try first word match
      if (destinationIndex === -1) {
        const firstWord = destinationLower.split(/\s+/)[0];
        if (firstWord && firstWord.length > 3) {
          destinationIndex = stations.findIndex(s => 
            s.station.toLowerCase().includes(firstWord)
          );
        }
      }

      if (destinationIndex === -1) {
        console.log('❌ Destination not found in route');
        console.log('   Looking for:', destinationStation);
        console.log('   Available stations:', stations.map(s => s.station).join(', '));
        return null;
      }

      const destinationStationObj = stations[destinationIndex];
      console.log(`✅ Destination found: ${destinationStationObj.station}`);

      const currentIndex = stations.indexOf(currentStation);
      
      // Get upcoming stations between current and destination
      const upcomingStations = stations.slice(currentIndex + 1, destinationIndex + 1);
      
      console.log(`📊 Stations remaining: ${upcomingStations.length}`);

      // Calculate distance correctly
      const currentDistance = parseInt(currentStation.distance || '0');
      const destinationDistance = parseInt(destinationStationObj.distance || '0');
      const distanceRemaining = Math.max(0, destinationDistance - currentDistance);

      console.log(`📏 Distance: ${currentDistance} km → ${destinationDistance} km = ${distanceRemaining} km remaining`);

      // Parse delay minutes
      const delayString = currentStation.delay || 'On Time';
      let delayMinutes = 0;
      
      if (delayString.toLowerCase().includes('min')) {
        const match = delayString.match(/(\d+)\s*min/i);
        if (match) {
          delayMinutes = parseInt(match[1]);
        }
      } else if (delayString.match(/^\d+$/)) {
        delayMinutes = parseInt(delayString);
      }

      const nextStation = upcomingStations[0]?.station || destinationStationObj.station;

      console.log(`✅ Live Status Summary:`);
      console.log(`   Current: ${currentStation.station}`);
      console.log(`   Next: ${nextStation}`);
      console.log(`   Stations remaining: ${upcomingStations.length}`);
      console.log(`   Distance remaining: ${distanceRemaining} km`);
      console.log(`   Delay: ${delayMinutes} minutes`);
      console.log('=====================================\n');

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
      console.error('Stack:', (error as Error).stack);
      return null;
    }
  }

  formatDateForAPI(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const formatted = `${day}-${month}-${year}`;
    console.log(`📅 Date formatted: ${date.toISOString()} → ${formatted}`);
    return formatted;
  }
}

export const trainService = new TrainService();