export interface User {
    telegram_id: number;
    phone?: string;
    name: string;
    username?: string;
    language?: string;
    emergency_contact?: string;
    created_at?: Date;
  }
  
  export interface Trip {
    id: number;
    user_telegram_id: number;
    type: 'bus' | 'train';
    from_location?: string;
    to_location: string;
    status: string;
    current_lat?: number;
    current_lng?: number;
    destination_lat?: number;
    destination_lng?: number;
    pnr?: string;
    train_number?: string;
    train_name?: string;
    departure_time?: Date;
    arrival_time?: Date;
    alert_time?: Date;
    confirmed?: boolean;
  }
  
  export interface CallLog {
    id: number;
    trip_id: number;
    call_id: string;
    attempt_number: number;
    status: string;
    duration?: number;
    transcript?: string;
    created_at?: Date;
  }
  
  export interface TrainData {
    pnr: string;
    train_number: string;
    train_name: string;
    from: string;
    to: string;
    departure: Date;
    arrival: Date;
  }

  export interface TripWithUser extends Trip {
    phone?: string | null;
    name?: string | null;
    username?: string | null;
  }
  
  