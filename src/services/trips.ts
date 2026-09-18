import api from './api';

export interface TripStopType {
    value: string;
    label: string;
}

export interface TripStop {
    id: number;
    trip_id: number;
    category: string;
    category_label: string;
    location_name: string;
    description: string;
    created_by_user_id?: number | null;
    created_by_type: 'empresa' | 'motorista' | string;
    status: 'programada' | 'em_andamento' | 'concluida' | string;
    started_at?: string | null;
    completed_at?: string | null;
    created_at: string;
    delay_grace_hours?: number;
    elapsed_seconds: number;
    elapsed_hours?: number;
    free_remaining_seconds?: number;
    grace_period_exceeded?: boolean;
    overtime_seconds?: number;
}

export interface TripLocation {
    id: number;
    trip_id: number;
    latitude: number;
    longitude: number;
    speed: number | null;
    created_at: string;
}

export interface TripVehicleSummary {
    id: number;
    company_id?: number | null;
    driver_id?: number | null;
    plate: string;
    brand: string | null;
    model_name: string | null;
    vehicle_type?: string | null;
    tonnage_capacity?: number | null;
    volume_capacity?: number | null;
    photo?: string | null;
    status?: string;
    current_lat?: number | null;
    current_lng?: number | null;
    location_updated_at?: string | null;
}

export interface TripLoadSummary {
    id: number;
    client_id?: number | null;
    code: string;
    load_type: string;
    load_name?: string | null;
    description?: string | null;
    weight?: number | null;
    weight_unit?: string | null;
    volume?: number | null;
    negotiable?: boolean;
    origin: string;
    destination: string;
    origin_lat?: number | null;
    origin_lng?: number | null;
    destination_lat?: number | null;
    destination_lng?: number | null;
    departure_date?: string | null;
    load_fill?: string | null;
    suggested_vehicle_type?: string | null;
    instructions?: string | null;
    status?: string;
    created_at?: string;
    updated_at?: string;
}

export interface TripDriverSummary {
    id: number;
    user_id: number;
    company_id?: number | null;
    license_number?: string | null;
    years_experience?: number | null;
    average_rating?: number;
    total_trips?: number;
    available?: boolean;
    current_lat?: number | null;
    current_lng?: number | null;
    location_updated_at?: string | null;
    name?: string | null;
    phone?: string | null;
    profile_photo?: string | null;
}

export interface TripActivity {
    id: number;
    trip_id: number;
    event_type: string;
    title: string;
    description?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    created_at: string;
}

export interface Trip {
    id: number;
    load_id?: number;
    company_id?: number | null;
    driver_id?: number | null;
    vehicle_id?: number | null;
    load_code: string;
    load_type?: string;
    origin: string;
    destination: string;
    origin_lat?: number | null;
    origin_lng?: number | null;
    destination_lat?: number | null;
    destination_lng?: number | null;
    client_name: string;
    client_phone?: string | null;
    status: string;
    en_route_pickup_at?: string | null;
    arrived_pickup_at?: string | null;
    loaded_at?: string | null;
    started_at: string | null;
    arrived_at?: string | null;
    client_confirmed_at?: string | null;
    completed_at?: string | null;
    total_distance_km?: number | null;
    traveled_distance_km?: number | null;
    progress_percent?: number | null;
    estimated_time: string | null;
    departure_date: string | null;
    created_at: string;
    stops?: TripStop[];
    activities?: TripActivity[];
    load?: TripLoadSummary | null;
    vehicle?: TripVehicleSummary | null;
    driver?: TripDriverSummary | null;
}

export interface TripStartPayload {
    vehicle_id?: number;
    total_distance_km?: number;
    estimated_time?: string;
}

export interface TripLocationCreatePayload {
    latitude: number;
    longitude: number;
    speed?: number;
    traveled_distance_km?: number;
}

export interface TripStopCreatePayload {
    category: string;
    location_name: string;
    description: string;
}

export const tripService = {
    async getMyTrips(group?: 'em_andamento' | 'concluidas'): Promise<Trip[]> {
        const response = await api.get('/driver/trips', {
            params: group ? { group } : undefined,
        });
        return response.data;
    },

    async getTrip(id: number | string): Promise<Trip> {
        const response = await api.get(`/driver/trips/${id}`);
        return response.data;
    },

    async startPickupTrip(id: number | string): Promise<Trip> {
        const response = await api.patch(`/driver/trips/${id}/start-pickup`);
        return response.data;
    },

    async arrivePickupTrip(id: number | string): Promise<Trip> {
        const response = await api.patch(`/driver/trips/${id}/arrive-pickup`);
        return response.data;
    },

    async confirmLoadedTrip(id: number | string): Promise<Trip> {
        const response = await api.patch(`/driver/trips/${id}/confirm-loaded`);
        return response.data;
    },

    async startTrip(id: number | string, data: TripStartPayload = {}): Promise<Trip> {
        const response = await api.patch(`/driver/trips/${id}/start`, data);
        return response.data;
    },

    async endTrip(id: number | string): Promise<Trip> {
        const response = await api.patch(`/driver/trips/${id}/end`);
        return response.data;
    },

    async getTripLocations(id: number | string): Promise<TripLocation[]> {
        const response = await api.get(`/driver/trips/${id}/locations`);
        return response.data;
    },

    async addTripLocation(id: number | string, data: TripLocationCreatePayload): Promise<TripLocation> {
        const response = await api.post(`/driver/trips/${id}/locations`, data);
        return response.data;
    },

    async getTripStopTypes(): Promise<TripStopType[]> {
        const response = await api.get('/trip-stops/categories');
        return response.data;
    },

    async getTripStops(id: number | string): Promise<TripStop[]> {
        const response = await api.get(`/trip-stops/${id}`);
        return response.data;
    },

    async createTripStop(id: number | string, data: TripStopCreatePayload): Promise<TripStop> {
        const response = await api.post(`/trip-stops/${id}`, data);
        return response.data;
    },

    async startTripStop(id: number | string, stopId: number): Promise<TripStop> {
        const response = await api.patch(`/trip-stops/${id}/${stopId}/start`);
        return response.data;
    },

    async completeTripStop(id: number | string, stopId: number): Promise<TripStop> {
        const response = await api.patch(`/trip-stops/${id}/${stopId}/complete`);
        return response.data;
    },
};
