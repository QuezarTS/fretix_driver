import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { AnimatedRegion, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { CustomDialog } from '@/components/custom-dialog';
import { LoadTypeImage } from '@/components/load-type-image';
import { TripStatusBadge, type LoadStatusType } from '@/components/trip-status-indicator';
import { FretixColors } from '@/constants/theme';
import { useWebSocket } from '@/context/WebSocketContext';
import { useDriverTripLocationSharing } from '@/hooks/useDriverTripLocationSharing';
import { useTripRealtime } from '@/hooks/useTripRealtime';
import {
  googleMapsService,
  type GoogleRouteSuggestion,
  type GoogleRouteStep,
  type MapCoordinate,
  type MozambiquePlaceSuggestion,
} from '@/services/google-maps';
import { loadService, type LoadDetail } from '@/services/loads';
import { tripService, type Trip, type TripLocation, type TripStop } from '@/services/trips';
import { resolveMediaUrl } from '@/utils/media-url';
import { buildReturnTo, goBackSmart, pushWithReturnTo, useSmartBackHandler } from '@/utils/navigation';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const COLLAPSED_HEIGHT = 178;
const EXPANDED_HEIGHT = SCREEN_HEIGHT * 0.72;
const DRAG_THRESHOLD = 60;
const FOOTER_HEIGHT = 130;


type Coordinate = MapCoordinate;
// Map matching visual + recálculo de rota.
// Até 55 m da polyline, o marcador é encaixado visualmente na estrada.
// Acima de 75 m por 2 amostras seguidas, consideramos desvio real e recalculamos.
const ROUTE_SNAP_THRESHOLD_KM = 0.045;
const ROUTE_DEVIATION_THRESHOLD_KM = 0.065;
const REROUTE_MIN_INTERVAL_MS = 6_000;
const OFF_ROUTE_SAMPLES_REQUIRED = 2;
const NAVIGATION_CAMERA_ZOOM = 17;
const NAVIGATION_CAMERA_PITCH = 67;
const GUIDANCE_HIGHLIGHT_DISTANCE_KM = 0.3;
const DEFAULT_MAP_CENTER: Coordinate = { latitude: -18.6657, longitude: 35.5296 };

const normalizeTripStatus = (value?: string | null) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const isCompletedStatus = (value?: string | null) =>
  ['concluida', 'concluido', 'completed', 'complete', 'finalizada', 'finalizado']
    .includes(normalizeTripStatus(value));

const getEffectiveTripStatus = (trip: Trip | null | undefined, liveStatus?: string | null) => {
  if (
    trip?.completed_at ||
    trip?.client_confirmed_at ||
    isCompletedStatus(liveStatus) ||
    isCompletedStatus(trip?.status)
  ) {
    return 'concluida';
  }

  return liveStatus ?? trip?.status ?? 'aguardando_inicio';
};

const getTripStatus = (status: string): LoadStatusType => {
  if (status === 'aguardando_inicio') return 'disponivel';
  if (status === 'indo_carregar') return 'indo_carregar';
  if (status === 'chegou_origem') return 'chegou_origem';
  if (status === 'carregado') return 'carregado';
  if (status === 'viagem_iniciada') return 'em_viagem';
  if (status === 'aguardando_cliente') return 'em_andamento';
  if (status === 'concluida') return 'concluido';
  if (status === 'cancelado') return 'cancelado';
  return 'disponivel';
};

const getTripStatusLabel = (status: string) => {
  if (status === 'aguardando_inicio') return 'Aguardando início';
  if (status === 'indo_carregar') return 'Indo Carregar';
  if (status === 'chegou_origem') return 'Chegou à Origem';
  if (status === 'carregado') return 'Carga Carregada';
  if (status === 'viagem_iniciada') return 'Em Viagem';
  if (status === 'aguardando_cliente') return 'Aguardando Cliente';
  if (status === 'concluida') return 'Concluída';
  if (status === 'cancelado') return 'Cancelada';
  return status.replace(/_/g, ' ');
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return 'Não informado';
  return new Date(dateStr).toLocaleDateString('pt-MZ', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatDateTime = (dateStr: string | null | undefined) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('pt-MZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const formatWaitDuration = (seconds: number | null | undefined) => {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}min`;
  return `${minutes}min`;
};

const formatCurrency = (value: number | null | undefined) => {
  if (value == null) return 'Sob consulta';
  return `${value.toLocaleString('pt-MZ', { minimumFractionDigits: 2 })} MT`;
};

const formatDistance = (value?: number | null) => {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(1)} km`;
};

const parseGoogleDistanceKm = (distanceText?: string | null) => {
  if (!distanceText) return null;

  const normalized = distanceText
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  const numericPart = normalized.replace(/[^\d.,]/g, '');
  if (!numericPart) return null;

  let parsed: number;

  if (numericPart.includes(',')) {
    // Ex.: "1.186,4 km" -> 1186.4
    parsed = Number.parseFloat(numericPart.replace(/\./g, '').replace(',', '.'));
  } else if (/^\d{1,3}(\.\d{3})+$/.test(numericPart)) {
    // Google em pt pode devolver "1.186 km" para 1186 km.
    parsed = Number.parseFloat(numericPart.replace(/\./g, ''));
  } else {
    parsed = Number.parseFloat(numericPart);
  }

  if (!Number.isFinite(parsed)) return null;
  if (normalized.includes(' km')) return parsed;
  if (normalized.endsWith('m') || normalized.includes(' m')) return parsed / 1000;

  return null;
};

const getPolylineDistanceKm = (coordinates: Coordinate[]) => {
  if (coordinates.length < 2) return 0;

  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    total += getDistanceKm(coordinates[index - 1], coordinates[index]);
  }
  return total;
};

const getTrackedDistanceKm = (locations: TripLocation[]) => {
  if (locations.length < 2) return 0;

  let total = 0;

  for (let index = 1; index < locations.length; index += 1) {
    const previous = locations[index - 1];
    const current = locations[index];

    const distanceKm = getDistanceKm(
      { latitude: previous.latitude, longitude: previous.longitude },
      { latitude: current.latitude, longitude: current.longitude },
    );

    const previousTime = new Date(previous.created_at).getTime();
    const currentTime = new Date(current.created_at).getTime();
    const deltaHours = (currentTime - previousTime) / 3_600_000;

    // Descarta saltos de GPS incompatíveis com um camião.
    if (deltaHours > 0) {
      const impliedSpeedKmH = distanceKm / deltaHours;
      if (impliedSpeedKmH > 220) continue;
    } else if (distanceKm > 1) {
      continue;
    }

    total += distanceKm;
  }

  return total;
};

const toCoordinateNumber = (value: number | string | null | undefined) => {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value;
  return Number.isFinite(parsed) ? Number(parsed) : null;
};

const getCoordinate = (
  latitude: number | string | null | undefined,
  longitude: number | string | null | undefined,
): Coordinate | null => {
  const parsedLatitude = toCoordinateNumber(latitude);
  const parsedLongitude = toCoordinateNumber(longitude);
  if (parsedLatitude == null || parsedLongitude == null) return null;
  const coordinate = { latitude: parsedLatitude, longitude: parsedLongitude };
  return isUsableCoordinate(coordinate) ? coordinate : null;
};

const getFirstUsableCoordinate = (
  primaryLatitude: number | string | null | undefined,
  primaryLongitude: number | string | null | undefined,
  secondaryLatitude: number | string | null | undefined,
  secondaryLongitude: number | string | null | undefined,
) => getCoordinate(primaryLatitude, primaryLongitude) ?? getCoordinate(secondaryLatitude, secondaryLongitude);

const getTripRouteData = (trip: Trip) => {
  const load = trip.load;
  const origin = load?.origin ?? trip.origin ?? 'Origem indisponível';
  const destination = load?.destination ?? trip.destination ?? 'Destino indisponível';
  const loadTitle =
    load?.load_name ||
    (load?.load_type ? `Carga de ${load.load_type}` : trip.load_code || `Carga #${trip.load_id ?? trip.id}`);
  // Never invent a coordinate here. A fixed fallback can put a Lichinga trip
  // hundreds of kilometres away; when coordinates are missing, Google resolves
  // the saved address instead. The load is the source selected in CargoLink's
  // location picker, so it takes priority over a potentially stale trip copy.
  const originCoordinate = getFirstUsableCoordinate(
    load?.origin_lat, load?.origin_lng, trip.origin_lat, trip.origin_lng,
  );
  const destinationCoordinate = getFirstUsableCoordinate(
    load?.destination_lat, load?.destination_lng, trip.destination_lat, trip.destination_lng,
  );

  return { origin, destination, loadTitle, originCoordinate, destinationCoordinate };
};

const coordinatesMatch = (a: Coordinate, b: Coordinate) =>
  Math.abs(a.latitude - b.latitude) < 0.00001 && Math.abs(a.longitude - b.longitude) < 0.00001;

const normalizeTripLocations = (locations: TripLocation[]): Coordinate[] =>
  locations
    .map((location) => ({ latitude: location.latitude, longitude: location.longitude }))
    .filter((coordinate, index, all) => index === 0 || !coordinatesMatch(coordinate, all[index - 1]));

const getDistanceKm = (a: Coordinate, b: Coordinate) => {
  const radiusKm = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radiusKm * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/**
 * Projecta a posição GPS no segmento mais próximo da rota.
 * Isto funciona como "map matching" visual: enquanto o GPS estiver perto
 * da estrada calculada, o camião aparece exactamente sobre a polyline.
 */
const getClosestPointOnRoute = (point: Coordinate, route: Coordinate[]) => {
  if (route.length === 0) {
    return {
      coordinate: point,
      distanceKm: Number.POSITIVE_INFINITY,
      segmentIndex: 0,
    };
  }

  if (route.length === 1) {
    return {
      coordinate: route[0],
      distanceKm: getDistanceKm(point, route[0]),
      segmentIndex: 0,
    };
  }

  const earthRadiusM = 6_371_000;
  const originLatRad = (point.latitude * Math.PI) / 180;
  const cosLat = Math.max(0.000001, Math.abs(Math.cos(originLatRad)));

  const toLocalMeters = (coordinate: Coordinate) => {
    const dLat = ((coordinate.latitude - point.latitude) * Math.PI) / 180;
    const dLng = ((coordinate.longitude - point.longitude) * Math.PI) / 180;

    return {
      x: earthRadiusM * dLng * cosLat,
      y: earthRadiusM * dLat,
    };
  };

  let bestDistanceM = Number.POSITIVE_INFINITY;
  let bestCoordinate = point;
  let bestSegmentIndex = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const a = toLocalMeters(route[index]);
    const b = toLocalMeters(route[index + 1]);

    const abX = b.x - a.x;
    const abY = b.y - a.y;
    const lengthSquared = abX * abX + abY * abY;

    let t = 0;
    if (lengthSquared > 0) {
      t = Math.max(
        0,
        Math.min(1, -(a.x * abX + a.y * abY) / lengthSquared),
      );
    }

    const closestX = a.x + t * abX;
    const closestY = a.y + t * abY;
    const distanceM = Math.hypot(closestX, closestY);

    if (distanceM < bestDistanceM) {
      bestDistanceM = distanceM;
      bestSegmentIndex = index;
      bestCoordinate = {
        latitude:
          point.latitude +
          ((closestY / earthRadiusM) * 180) / Math.PI,
        longitude:
          point.longitude +
          ((closestX / (earthRadiusM * cosLat)) * 180) / Math.PI,
      };
    }
  }

  return {
    coordinate: bestCoordinate,
    distanceKm: bestDistanceM / 1000,
    segmentIndex: bestSegmentIndex,
  };
};

const getDistanceToRouteKm = (point: Coordinate, route: Coordinate[]) =>
  getClosestPointOnRoute(point, route).distanceKm;

const buildTraveledRouteCoordinates = (
  historyCoordinates: Coordinate[],
  liveCoordinate: Coordinate | null,
) => {
  const combined = [...historyCoordinates];
  if (liveCoordinate) {
    const last = combined[combined.length - 1];
    if (!last || !coordinatesMatch(last, liveCoordinate)) combined.push(liveCoordinate);
  }
  return combined;
};

const getProgressValue = (trip: Trip) => {
  if (typeof trip.progress_percent === 'number' && Number.isFinite(trip.progress_percent)) {
    return Math.max(0, Math.min(100, trip.progress_percent));
  }
  if (
    typeof trip.traveled_distance_km === 'number' &&
    typeof trip.total_distance_km === 'number' &&
    trip.total_distance_km > 0
  ) {
    return Math.max(0, Math.min(100, (trip.traveled_distance_km / trip.total_distance_km) * 100));
  }
  if (trip.status === 'concluida') return 100;
  if (trip.status === 'aguardando_cliente') return 95;
  if (trip.status === 'viagem_iniciada') return 0;
  return 0;
};

const formatCoordinate = (coordinate: Coordinate) =>
  `${coordinate.latitude.toFixed(5)}, ${coordinate.longitude.toFixed(5)}`;

const isUsableCoordinate = (coordinate: Coordinate) =>
  Number.isFinite(coordinate.latitude) &&
  Number.isFinite(coordinate.longitude) &&
  Math.abs(coordinate.latitude) <= 90 &&
  Math.abs(coordinate.longitude) <= 180 &&
  !(Math.abs(coordinate.latitude) < 0.0001 && Math.abs(coordinate.longitude) < 0.0001);

const getDirectionsEndpoint = (coordinate: Coordinate | null, address: string) =>
  coordinate ? coordinate : `${address}, Mocambique`;

const getBearing = (from: Coordinate, to: Coordinate) => {
  const startLat = (from.latitude * Math.PI) / 180;
  const endLat = (to.latitude * Math.PI) / 180;
  const deltaLng = ((to.longitude - from.longitude) * Math.PI) / 180;
  const y = Math.sin(deltaLng) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
};

const getNearestRouteIndex = (coordinate: Coordinate, route: Coordinate[]) => {
  if (route.length === 0) return 0;
  return route.reduce(
    (closest, point, index) => {
      const distance = getDistanceKm(coordinate, point);
      return distance < closest.distance ? { index, distance } : closest;
    },
    { index: 0, distance: Number.POSITIVE_INFINITY },
  ).index;
};

const getRemainingRouteCoordinates = (current: Coordinate, route: Coordinate[], isTripStarted: boolean) => {
  if (!isTripStarted || route.length < 2) return route;
  const nearestIndex = getNearestRouteIndex(current, route);
  return [current, ...route.slice(Math.min(nearestIndex + 1, route.length - 1))];
};

const getTraveledRoadCoordinates = (current: Coordinate, route: Coordinate[], isTripStarted: boolean) => {
  if (!isTripStarted || route.length < 2) return [];
  const nearestIndex = getNearestRouteIndex(current, route);
  return [...route.slice(0, nearestIndex + 1), current];
};

const splitGuidanceRoute = (current: Coordinate, route: Coordinate[], isTripStarted: boolean) => {
  const remaining = getRemainingRouteCoordinates(current, route, isTripStarted);
  if (!isTripStarted || remaining.length < 2) return { highlighted: remaining, preview: [] as Coordinate[] };

  let distanceKm = 0;
  let splitIndex = remaining.length - 1;
  for (let index = 1; index < remaining.length; index += 1) {
    distanceKm += getDistanceKm(remaining[index - 1], remaining[index]);
    if (distanceKm >= GUIDANCE_HIGHLIGHT_DISTANCE_KM) {
      splitIndex = index;
      break;
    }
  }

  return {
    highlighted: remaining.slice(0, splitIndex + 1),
    // Include the last highlighted point so the thin continuation joins it.
    preview: remaining.slice(splitIndex),
  };
};

const ensureRouteEndsAtDestination = (route: Coordinate[], destination: Coordinate | null) => {
  if (!destination || route.length === 0) return route;
  const lastPoint = route[route.length - 1];
  return getDistanceKm(lastPoint, destination) < 0.02 ? route : [...route, destination];
};

const buildRouteWaypoints = (history: Coordinate[], liveCoordinate: Coordinate | null) => {
  const combined = buildTraveledRouteCoordinates(history, liveCoordinate);
  if (combined.length <= 23) return combined;
  const stride = Math.ceil(combined.length / 23);
  return combined.filter((_, index) => index === combined.length - 1 || index % stride === 0).slice(0, 23);
};

const splitRouteAtCurrentPosition = (
  current: Coordinate,
  route: Coordinate[],
  active: boolean,
) => {
  if (!active || route.length < 2) {
    return {
      traveled: [] as Coordinate[],
      remaining: route,
    };
  }

  const projection = getClosestPointOnRoute(current, route);
  const splitIndex = Math.min(
    Math.max(projection.segmentIndex, 0),
    route.length - 2,
  );

  return {
    traveled: [
      ...route.slice(0, splitIndex + 1),
      projection.coordinate,
    ],
    remaining: [
      projection.coordinate,
      ...route.slice(splitIndex + 1),
    ],
  };
};

const extractRoadNameFromInstruction = (instruction?: string | null) => {
  if (!instruction) return null;

  const cleaned = instruction.replace(/\s+/g, ' ').trim();

  const directionalOnly =
    /^(siga|continue|vire|mantenha).*(norte|sul|leste|oeste|nordeste|noroeste|sudeste|sudoeste)$/i;
  if (directionalOnly.test(cleaned)) return null;

  const namedRoad = cleaned.match(
    /((?:avenida|av\.?|rua|estrada|rodovia|autoestrada|n\d+|en\d+)\s+[^,;]+)/i,
  );
  if (namedRoad?.[1]) return namedRoad[1].trim();

  const afterConnector = cleaned.match(
    /(?:na|no|pela|pelo|para a|para o)\s+(.+)$/i,
  );
  if (afterConnector?.[1]) {
    const candidate = afterConnector[1].trim();
    if (
      candidate.length >= 2 &&
      !/^(norte|sul|leste|oeste|nordeste|noroeste|sudeste|sudoeste)$/i.test(candidate)
    ) {
      return candidate;
    }
  }

  return null;
};

const getNextNavigationStep = (current: Coordinate, steps: GoogleRouteStep[]) => {
  if (steps.length === 0) return null;
  const nextStep = steps.find((step) => getDistanceKm(current, step.endLocation) > 0.08) ?? steps[steps.length - 1];
  return {
    ...nextStep,
    distanceKm: getDistanceKm(current, nextStep.endLocation),
  };
};


type JourneyStageState = 'completed' | 'active' | 'upcoming';

type JourneyStage = {
  key: string;
  title: string;
  subtitle: string;
  time?: string | null;
  state: JourneyStageState;
};

const getJourneyStatusRank = (status: string) => {
  const normalized = normalizeTripStatus(status);

  const ranks: Record<string, number> = {
    aguardando_inicio: 0,
    indo_carregar: 1,
    chegou_origem: 2,
    carregado: 3,
    viagem_iniciada: 4,
    aguardando_cliente: 5,
    concluida: 6,
    concluido: 6,
    completed: 6,
    finalizada: 6,
    finalizado: 6,
  };

  return ranks[normalized] ?? 0;
};

const getJourneyStages = (
  trip: Trip,
  currentStatus: string,
): JourneyStage[] => {
  const rank = getJourneyStatusRank(currentStatus);

  const stateFor = (
    completedWhenRankAtLeast: number,
    activeWhenRanks: number[],
  ): JourneyStageState => {
    if (rank >= completedWhenRankAtLeast) return 'completed';
    if (activeWhenRanks.includes(rank)) return 'active';
    return 'upcoming';
  };

  const loadingState = stateFor(3, [2]);
  const transportState = stateFor(5, [3, 4]);
  const confirmationState = stateFor(6, [5]);

  return [
    {
      key: 'pickup-drive',
      title: 'Indo carregar',
      subtitle:
        rank <= 1
          ? 'A percorrer a estrada até ao local de origem.'
          : 'Deslocação até à origem concluída.',
      time: trip.en_route_pickup_at,
      state: stateFor(2, [0, 1]),
    },
    {
      key: 'pickup-arrival',
      title: 'Chegou à origem',
      subtitle: 'Chegada ao local de recolha confirmada.',
      time: trip.arrived_pickup_at,
      state: rank >= 2 ? 'completed' : 'upcoming',
    },
    {
      key: 'loaded',
      title:
        loadingState === 'active'
          ? 'A carregar'
          : 'Carga carregada',
      subtitle:
        loadingState === 'active'
          ? 'O carregamento da carga está em curso.'
          : loadingState === 'completed'
            ? 'Carga confirmada no camião.'
            : 'Aguardando chegada e carregamento.',
      time: trip.loaded_at,
      state: loadingState,
    },
    {
      key: 'transport',
      title:
        rank === 3
          ? 'Pronto para iniciar viagem'
          : transportState === 'active'
            ? 'Em viagem'
            : 'Transporte até ao destino',
      subtitle:
        rank === 3
          ? 'Carga pronta. Inicie o percurso até ao destino.'
          : transportState === 'active'
            ? 'O camião está a transportar a carga.'
            : transportState === 'completed'
              ? 'Percurso de transporte concluído.'
              : 'Aguardando início da viagem.',
      time:
        transportState === 'completed'
          ? trip.arrived_at
          : trip.started_at,
      state: transportState,
    },
    {
      key: 'destination-arrival',
      title: 'Chegada ao destino',
      subtitle: 'Chegada ao destino final confirmada.',
      time: trip.arrived_at,
      state: rank >= 5 ? 'completed' : 'upcoming',
    },
    {
      key: 'client-confirmation',
      title:
        confirmationState === 'active'
          ? 'Aguardando confirmação'
          : 'Concluída',
      subtitle:
        confirmationState === 'active'
          ? 'Aguardando o cliente confirmar a entrega.'
          : confirmationState === 'completed'
            ? 'Entrega confirmada e viagem encerrada.'
            : 'Confirmação final da entrega.',
      time: trip.completed_at ?? trip.client_confirmed_at,
      state: confirmationState,
    },
  ];
};

export default function TripDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string; returnTo?: string | string[]; from?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const numericTripId = id ? Number.parseInt(id, 10) : null;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loadedTripId, setLoadedTripId] = useState<string | null>(null);
  const [routeLoad, setRouteLoad] = useState<LoadDetail | null>(null);
  const [stops, setStops] = useState<TripStop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [routePath, setRoutePath] = useState<Coordinate[]>([]);
  const [routeOptions, setRouteOptions] = useState<GoogleRouteSuggestion[]>([]);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [locationHistory, setLocationHistory] = useState<TripLocation[]>([]);
  const [isMapReady, setIsMapReady] = useState(false);
  const [is3DMode, setIs3DMode] = useState(true);
  const [currentPlace, setCurrentPlace] = useState<MozambiquePlaceSuggestion | null>(null);
  const [currentPlaceLoading, setCurrentPlaceLoading] = useState(false);
  const [currentZoneLabel, setCurrentZoneLabel] = useState<string | null>(null);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogProps, setDialogProps] = useState({
    title: '',
    message: '',
    type: 'info' as 'success' | 'error' | 'info',
  });

  const sheetHeight = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const lastHeight = useRef(COLLAPSED_HEIGHT);
  const mapRef = useRef<MapView | null>(null);

  // Marcador animado: a posição desliza entre actualizações GPS em vez de saltar.
  const driverAnimatedCoordinate = useRef(
    new AnimatedRegion({
      latitude: DEFAULT_MAP_CENTER.latitude,
      longitude: DEFAULT_MAP_CENTER.longitude,
      latitudeDelta: 0,
      longitudeDelta: 0,
    }),
  ).current;
  const previousDriverCoordinateRef = useRef<Coordinate | null>(null);
  const [driverBearing, setDriverBearing] = useState(0);

  const lastRerouteRef = useRef<{ coordinate: Coordinate; timestamp: number } | null>(null);
  const rerouteInFlightRef = useRef(false);
  const offRouteSamplesRef = useRef(0);
  const tripLoadRequestRef = useRef(0);
  useSmartBackHandler({ returnTo, from, fallback: '/trips' });
  const { addListenerForTypes } = useWebSocket();

  const handleBack = () => goBackSmart({ returnTo, from, fallback: '/trips' });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        const newH = Math.max(COLLAPSED_HEIGHT, Math.min(EXPANDED_HEIGHT, lastHeight.current - g.dy));
        sheetHeight.setValue(newH);
      },
      onPanResponderRelease: (_, g) => {
        const expanding = g.dy < -DRAG_THRESHOLD;
        const collapsing = g.dy > DRAG_THRESHOLD;
        const target = expanding
          ? EXPANDED_HEIGHT
          : collapsing
            ? COLLAPSED_HEIGHT
            : lastHeight.current > (COLLAPSED_HEIGHT + EXPANDED_HEIGHT) / 2
              ? EXPANDED_HEIGHT
              : COLLAPSED_HEIGHT;

        lastHeight.current = target;
        setIsExpanded(target === EXPANDED_HEIGHT);
        Animated.spring(sheetHeight, { toValue: target, useNativeDriver: false, tension: 60, friction: 12 }).start();
      },
    }),
  ).current;

  const toggleSheet = () => {
    const target = isExpanded ? COLLAPSED_HEIGHT : EXPANDED_HEIGHT;
    lastHeight.current = target;
    setIsExpanded(!isExpanded);
    Animated.spring(sheetHeight, { toValue: target, useNativeDriver: false, tension: 60, friction: 12 }).start();
  };

  const { liveTrip, liveStatus, liveLocation, lastLocationUpdateAt, applyTripSnapshot } = useTripRealtime(
    Number.isFinite(numericTripId) ? numericTripId : null,
    { initialTrip: trip },
  );

  const currentTrip = loadedTripId === id ? (liveTrip ?? trip) : null;
  const tripForRoute = routeLoad && currentTrip
    ? ({ ...currentTrip, load: { ...currentTrip.load, ...routeLoad } } as Trip)
    : currentTrip;
  const currentStatus = getEffectiveTripStatus(currentTrip, liveStatus);
  const isTripStarted = ['indo_carregar', 'chegou_origem', 'carregado', 'viagem_iniciada'].includes(currentStatus);
  const isHeadingToPickup = ['indo_carregar', 'chegou_origem'].includes(currentStatus);
  // Mantém o GPS local activo durante as fases de navegação.
  // O envio ao servidor só começa quando a viagem de entrega estiver oficialmente iniciada.
  const shouldTrackDriverLocation = isTripStarted;
  const shouldPersistDriverLocation = currentStatus === 'viagem_iniciada';

  const {
    isSharing: isDriverLocationSharing,
    sharingStatus: driverLocationSharingStatus,
    permissionGranted: driverLocationPermissionGranted,
    lastSentAt: driverLocationLastSentAt,
    errorMessage: driverLocationError,
    currentLocation: driverDeviceLocation,
  } = useDriverTripLocationSharing({
    tripId: Number.isFinite(numericTripId) ? numericTripId : null,
    enabled: shouldTrackDriverLocation,
    persistToServer: shouldPersistDriverLocation,
  });
  // The backend is the source of truth for the trip position. This keeps the
  // driver and CargoLink maps in sync even when the driver's realtime socket
  // is temporarily disconnected.
  const savedLocation = normalizeTripLocations(locationHistory).at(-1) ?? null;
  const driverSavedLocation = getCoordinate(
    currentTrip?.driver?.current_lat ?? currentTrip?.vehicle?.current_lat,
    currentTrip?.driver?.current_lng ?? currentTrip?.vehicle?.current_lng,
  );
  // A posição do próprio telefone tem prioridade para a navegação do motorista.
  const navigationLocation =
    driverDeviceLocation ?? liveLocation ?? savedLocation ?? driverSavedLocation;

  const effectiveRouteForSnap =
    routePath.length > 1
      ? routePath
      : routeOptions[0]?.coordinates ?? [];

  const routeProjection =
    navigationLocation && effectiveRouteForSnap.length > 1
      ? getClosestPointOnRoute(navigationLocation, effectiveRouteForSnap)
      : null;

  const isSnappedToRoute =
    routeProjection != null &&
    routeProjection.distanceKm <= ROUTE_SNAP_THRESHOLD_KM;

  const displayNavigationLocation =
    navigationLocation && isSnappedToRoute
      ? routeProjection!.coordinate
      : navigationLocation;

  // Suaviza o movimento do camião e usa a direcção da estrada quando o
  // veículo está encaixado na rota. Fora da rota usa o bearing do GPS.
  useEffect(() => {
    if (!displayNavigationLocation) return;

    if (
      isSnappedToRoute &&
      routeProjection &&
      effectiveRouteForSnap[routeProjection.segmentIndex + 1]
    ) {
      setDriverBearing(
        getBearing(
          effectiveRouteForSnap[routeProjection.segmentIndex],
          effectiveRouteForSnap[routeProjection.segmentIndex + 1],
        ),
      );
    } else {
      const previous = previousDriverCoordinateRef.current;

      if (previous && !coordinatesMatch(previous, displayNavigationLocation)) {
        setDriverBearing(getBearing(previous, displayNavigationLocation));
      }
    }

    (driverAnimatedCoordinate as any)
      .timing({
        latitude: displayNavigationLocation.latitude,
        longitude: displayNavigationLocation.longitude,
        duration: 900,
        useNativeDriver: false,
      })
      .start();

    previousDriverCoordinateRef.current = displayNavigationLocation;
  }, [
    driverAnimatedCoordinate,
    displayNavigationLocation?.latitude,
    displayNavigationLocation?.longitude,
    isSnappedToRoute,
    routeProjection?.segmentIndex,
    routePath,
  ]);

  const showDialog = useCallback((title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setDialogProps({ title, message, type });
    setDialogVisible(true);
  }, []);

  const loadData = useCallback(
    async (silent = false) => {
      if (!id) return;
      const requestId = ++tripLoadRequestRef.current;
      try {
        if (!silent) setLoading(true);
        const [tripData, stopsData, locationsData] = await Promise.all([
          tripService.getTrip(id),
          tripService.getTripStops(id).catch(() => []),
          tripService.getTripLocations(id).catch(() => []),
        ]);
        if (requestId !== tripLoadRequestRef.current) return;
        setTrip(tripData);
        setLoadedTripId(id);
        setStops(stopsData);
        setLocationHistory(locationsData);
        applyTripSnapshot(tripData);
      } catch (error) {
        if (requestId !== tripLoadRequestRef.current) return;
        console.error('Failed to load trip details:', error);
        showDialog('Erro', 'Não foi possível carregar os detalhes da viagem.', 'error');
      } finally {
        if (requestId === tripLoadRequestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [id, applyTripSnapshot, showDialog],
  );

  useEffect(() => {
    // Expo Router can reuse this screen when another trip is opened.
    // Clear the old map immediately instead of showing its route while loading.
    tripLoadRequestRef.current += 1;
    lastRerouteRef.current = null;
    rerouteInFlightRef.current = false;
    offRouteSamplesRef.current = 0;
    setTrip(null);
    setLoadedTripId(null);
    setRouteLoad(null);
    setStops([]);
    setLocationHistory([]);
    setRoutePath([]);
    setRouteOptions([]);
    setRouteError(null);
    setCurrentPlace(null);
    setCurrentZoneLabel(null);
    setIsMapReady(false);
    setLoading(true);
  }, [id]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!numericTripId) return;

    return addListenerForTypes(
      [
        'trip.stop_scheduled',
        'trip.stop_started',
        'trip.stop_completed',
        'trip.delay_fee_started',
      ],
      (event) => {
        if (
          event.trip_id != null &&
          Number(event.trip_id) !== numericTripId
        ) {
          return;
        }

        void tripService
          .getTripStops(numericTripId)
          .then(setStops)
          .catch(() => undefined);
      },
    );
  }, [numericTripId, addListenerForTypes]);

  useEffect(() => {
    const loadId = currentTrip?.load_id ?? currentTrip?.load?.id;
    if (!loadId) {
      setRouteLoad(null);
      return;
    }
    let active = true;
    void loadService.getLoadById(loadId)
      .then((load) => {
        if (active) {
          lastRerouteRef.current = null;
          setRouteLoad(load);
        }
      })
      .catch(() => {
        // The trip summary remains a safe fallback if this endpoint is unavailable.
        if (active) setRouteLoad(null);
      });
    return () => {
      active = false;
    };
  }, [currentTrip?.load_id, currentTrip?.load?.id]);

  useEffect(() => {
    if (!currentTrip) return;
    // For the pickup phases, route to Origin; once the delivery trip starts, route to Destination.
    let active = true;
    const { origin, destination, originCoordinate, destinationCoordinate } = getTripRouteData(tripForRoute ?? currentTrip);
    const routeOrigin = isTripStarted && navigationLocation ? navigationLocation : originCoordinate;
    // When heading to pickup, target = origin; otherwise target = destination.
    const routeTarget = isHeadingToPickup ? originCoordinate : destinationCoordinate;
    const routeTargetLabel = isHeadingToPickup ? origin : destination;

    const loadGoogleRoute = async () => {
      try {
        setRouteLoading(true);
        const routes = await googleMapsService.getDrivingRouteSuggestions(
          getDirectionsEndpoint(routeOrigin, origin),
          getDirectionsEndpoint(routeTarget, routeTargetLabel),
        );
        if (!active) return;
        if (routes.length > 0) {
          setRouteError(null);
          setRouteOptions(routes);
          setRoutePath(routes[0].coordinates);
        } else {
          setRouteError('Nao foi encontrada uma rota por estrada para este destino.');
          setRouteOptions([]);
          setRoutePath([]);
        }
      } catch (error) {
        if (!active) return;
        console.error('Failed to load Google route:', error);
        setRouteError(error instanceof Error ? error.message : 'Falha ao carregar rota do Google.');
        setRouteOptions([]);
        setRoutePath([]);
      } finally {
        if (active) setRouteLoading(false);
      }
    };

    void loadGoogleRoute();
    return () => {
      active = false;
    };
  }, [currentTrip?.id, isTripStarted, isHeadingToPickup, routeLoad?.id]);

  useEffect(() => {
    if (!currentTrip || !isMapReady) return;
    const { originCoordinate, destinationCoordinate } = getTripRouteData(tripForRoute ?? currentTrip);
    const historyCoordinates = normalizeTripLocations(locationHistory);
    const liveMarker = isTripStarted ? displayNavigationLocation : null;
    const traveledRouteCoordinates = buildTraveledRouteCoordinates(historyCoordinates, liveMarker);
    const currentCoordinate =
      displayNavigationLocation ??
      historyCoordinates[historyCoordinates.length - 1] ??
      originCoordinate ??
      destinationCoordinate;

    // 3D is the close navigation view. In 2D keep the complete route visible,
    // including the destination marker, just like CargoLink's route preview.
    if (isTripStarted && is3DMode && currentCoordinate) {
      const nextRoutePoint = routePath[Math.min(getNearestRouteIndex(currentCoordinate, routePath) + 1, routePath.length - 1)];
      mapRef.current?.animateCamera(
        {
          center: currentCoordinate,
          pitch: is3DMode ? NAVIGATION_CAMERA_PITCH : 0,
          heading: nextRoutePoint ? getBearing(currentCoordinate, nextRoutePoint) : 0,
          zoom: NAVIGATION_CAMERA_ZOOM,
        },
        { duration: 850 },
      );
      return;
    }

    const coordinates =
      traveledRouteCoordinates.length > 1
        ? traveledRouteCoordinates
        : routePath.length > 1
          ? routePath
          : [originCoordinate, destinationCoordinate].filter((coordinate): coordinate is Coordinate => coordinate !== null);

    if (coordinates.length > 0) mapRef.current?.fitToCoordinates(coordinates, {
      edgePadding: { top: 90, right: 60, bottom: COLLAPSED_HEIGHT + 40, left: 60 },
      animated: true,
    });
  }, [
    is3DMode,
    isMapReady,
    isTripStarted,
    displayNavigationLocation?.latitude,
    displayNavigationLocation?.longitude,
    locationHistory,
    routePath,
    currentTrip?.id,
    routeLoad?.id,
  ]);

  useEffect(() => {
    if (!id || !isTripStarted) return;
    // Fallback for when WebSocket events are delayed: reload the last position
    // that was actually persisted by the backend.
    const refreshBackendLocation = async () => {
      try {
        const locations = await tripService.getTripLocations(id);
        setLocationHistory(locations);
      } catch {
        // Keep the last confirmed backend position until the next retry.
      }
    };
    void refreshBackendLocation();
    const interval = setInterval(() => void refreshBackendLocation(), 12_000);
    return () => clearInterval(interval);
  }, [id, isTripStarted]);

  useEffect(() => {
    if (!currentTrip || !navigationLocation || !isTripStarted) return;
    if (rerouteInFlightRef.current) return;

    const now = Date.now();
    const last = lastRerouteRef.current;

    const activeRoute =
      routePath.length > 1
        ? routePath
        : routeOptions[0]?.coordinates ?? [];

    const distanceFromRouteKm =
      activeRoute.length > 1
        ? getDistanceToRouteKm(navigationLocation, activeRoute)
        : Number.POSITIVE_INFINITY;

    if (activeRoute.length > 1) {
      if (distanceFromRouteKm >= ROUTE_DEVIATION_THRESHOLD_KM) {
        offRouteSamplesRef.current += 1;
      } else {
        offRouteSamplesRef.current = 0;
        return;
      }

      // Duas leituras consecutivas fora da rota evitam recalcular por
      // uma única oscilação momentânea do GPS.
      if (offRouteSamplesRef.current < OFF_ROUTE_SAMPLES_REQUIRED) {
        return;
      }
    }

    if (last && now - last.timestamp < REROUTE_MIN_INTERVAL_MS) {
      return;
    }


    const {
      origin,
      destination,
      originCoordinate,
      destinationCoordinate,
    } = getTripRouteData(tripForRoute ?? currentTrip);

    const routeTarget = isHeadingToPickup
      ? originCoordinate
      : destinationCoordinate;
    const routeTargetLabel = isHeadingToPickup
      ? origin
      : destination;

    if (!routeTarget && !routeTargetLabel) return;

    rerouteInFlightRef.current = true;
    const requestVersion = tripLoadRequestRef.current;
    const requestCoordinate = navigationLocation;

    void (async () => {
      try {
        setRouteLoading(true);

        const routes = await googleMapsService.getDrivingRouteSuggestions(
          requestCoordinate,
          getDirectionsEndpoint(routeTarget, routeTargetLabel),
        );

        if (requestVersion !== tripLoadRequestRef.current) return;

        lastRerouteRef.current = {
          coordinate: requestCoordinate,
          timestamp: Date.now(),
        };
        offRouteSamplesRef.current = 0;

        if (routes.length > 0) {
          setRouteError(null);
          setRouteOptions(routes);
          setRoutePath(routes[0].coordinates);
        } else {
          setRouteError('Não foi encontrada uma nova rota por estrada.');
        }
      } catch (error) {
        if (requestVersion !== tripLoadRequestRef.current) return;

        console.error('Failed to refresh live route:', error);
        setRouteError(
          error instanceof Error
            ? error.message
            : 'Falha ao recalcular rota do Google.',
        );
      } finally {
        if (requestVersion === tripLoadRequestRef.current) {
          setRouteLoading(false);
        }
        rerouteInFlightRef.current = false;
      }
    })();
  }, [
    currentTrip?.id,
    isTripStarted,
    isHeadingToPickup,
    navigationLocation?.latitude,
    navigationLocation?.longitude,
    routePath,
    routeLoad?.id,
  ]);

  useEffect(() => {
    if (!currentTrip) return;

    const historyCoordinates = normalizeTripLocations(locationHistory);
    const coordinate =
      navigationLocation ??
      historyCoordinates[historyCoordinates.length - 1] ??
      getTripRouteData(tripForRoute ?? currentTrip).originCoordinate;

    if (!coordinate) {
      setCurrentPlace(null);
      setCurrentZoneLabel(null);
      return;
    }

    let active = true;

    const loadCurrentPlace = async () => {
      try {
        setCurrentPlaceLoading(true);

        const place = await googleMapsService.reverseGeocodeMozambiqueCoordinate(coordinate);
        if (!active) return;

        setCurrentPlace(place);

        // Primeiro tenta um bairro/sublocalidade real devolvido pelo geocoder.
        if (place?.neighborhood) {
          setCurrentZoneLabel(place.neighborhood);
          return;
        }

        // Se o Google não devolver o nome administrativo do bairro,
        // procura a referência identificável mais próxima das coordenadas.
        const nearby = await googleMapsService.getNearbyDestinationPlaces(coordinate);
        if (!active) return;

        const nearest = [...nearby].sort(
          (a, b) =>
            getDistanceKm(coordinate, a.coordinate) -
            getDistanceKm(coordinate, b.coordinate),
        )[0];

        const fallbackZone =
          nearest?.name
            ? `Zona de ${nearest.name}`
            : place?.city ??
              place?.district ??
              place?.name?.split(',')[0]?.trim() ??
              'Zona desconhecida';

        setCurrentZoneLabel(fallbackZone);
      } catch {
        if (active) {
          setCurrentPlace(null);
          setCurrentZoneLabel('Zona desconhecida');
        }
      } finally {
        if (active) setCurrentPlaceLoading(false);
      }
    };

    void loadCurrentPlace();

    return () => {
      active = false;
    };
  }, [
    currentTrip?.id,
    navigationLocation?.latitude,
    navigationLocation?.longitude,
    routeLoad?.id,
  ]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadData(true);
  };

  const handleStartPickup = async () => {
    if (!id) return;
    try {
      setStarting(true);
      const updated = await tripService.startPickupTrip(id);
      setTrip(updated);
      applyTripSnapshot(updated);
      void loadData(true);
      showDialog('Indo Carregar', 'Iniciou o deslocamento para o local de carregamento. O mapa irá guiá-lo à Origem.', 'success');
    } catch (error) {
      console.error('Failed to start pickup trip:', error);
      showDialog('Erro', 'Não foi possível iniciar o deslocamento para coleta.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleArrivePickup = async () => {
    if (!id) return;
    try {
      setStarting(true);
      const updated = await tripService.arrivePickupTrip(id);
      setTrip(updated);
      applyTripSnapshot(updated);
      void loadData(true);
      showDialog('Chegou à Origem', 'Confirmou a chegada ao local de carregamento.', 'success');
    } catch (error) {
      console.error('Failed to confirm pickup arrival:', error);
      showDialog('Erro', 'Não foi possível confirmar a chegada ao carregamento.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleConfirmLoaded = async () => {
    if (!id) return;
    try {
      setStarting(true);
      const updated = await tripService.confirmLoadedTrip(id);
      setTrip(updated);
      applyTripSnapshot(updated);
      void loadData(true);
      showDialog('Carga Carregada', 'Confirmou o carregamento da carga no camião. Pode iniciar a viagem de entrega!', 'success');
    } catch (error) {
      console.error('Failed to confirm loaded:', error);
      showDialog('Erro', 'Não foi possível confirmar o carregamento.', 'error');
    } finally {
      setStarting(false);
    }
  };

  const handleStartTrip = async () => {
    if (!id) return;

    try {
      setStarting(true);

      const routeDistanceKm =
        parseGoogleDistanceKm(routeOptions[0]?.distanceText) ??
        (routePath.length > 1 ? getPolylineDistanceKm(routePath) : null);

      const routeEstimatedTime =
        routeOptions[0]?.durationText ??
        currentTrip?.estimated_time ??
        undefined;

      const updated = await tripService.startTrip(id, {
        total_distance_km:
          routeDistanceKm != null && routeDistanceKm > 0
            ? Number(routeDistanceKm.toFixed(2))
            : undefined,
        estimated_time: routeEstimatedTime,
      });

      setTrip(updated);
      applyTripSnapshot(updated);
      void loadData(true);

      showDialog(
        'Viagem iniciada',
        'A viagem de entrega foi iniciada com sucesso. Distância, tempo estimado e localização serão acompanhados automaticamente.',
        'success',
      );
    } catch (error) {
      console.error('Failed to start trip:', error);
      showDialog('Erro', 'Não foi possível iniciar a viagem de entrega.', 'error');
    } finally {
      setStarting(false);
    }
  };

  if (loading && !currentTrip) {
    return (
      <View style={styles.loaderContainer}>
        <ActivityIndicator size="large" color={FretixColors.yellow} />
        <Text style={styles.loaderText}>A carregar viagem...</Text>
      </View>
    );
  }

  if (!currentTrip) {
    return (
      <View style={styles.loaderContainer}>
        <Ionicons name="alert-circle-outline" size={48} color={FretixColors.grayLight} />
        <Text style={styles.loaderText}>Viagem não encontrada.</Text>
        <Pressable onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backBtnText}>Voltar</Text>
        </Pressable>
      </View>
    );
  }

  const load = currentTrip.load;
  const { origin, destination, loadTitle, originCoordinate, destinationCoordinate } = getTripRouteData(tripForRoute ?? currentTrip);
  const primaryRoute = routeOptions[0];

  // Nunca desenha uma linha recta artificial entre dois pontos.
  // A rota visual vem exclusivamente da geometria real do Google Directions.
  // Se routePath estiver temporariamente vazio mas routeOptions já tiver a
  // geometria carregada, usa-a como fallback seguro.
  const routeCoordinates =
    routePath.length > 1
      ? routePath
      : primaryRoute?.coordinates && primaryRoute.coordinates.length > 1
        ? primaryRoute.coordinates
        : [];

  const hasDrivingRoute = routeCoordinates.length > 1;
  const historyCoordinates = normalizeTripLocations(locationHistory);
  const liveMarker = isTripStarted ? displayNavigationLocation : null;
  const traveledRouteCoordinates = buildTraveledRouteCoordinates(historyCoordinates, liveMarker);
  const currentCoordinate =
    displayNavigationLocation ??
    historyCoordinates[historyCoordinates.length - 1] ??
    originCoordinate ??
    destinationCoordinate ??
    DEFAULT_MAP_CENTER;

  // A imagem fornecida aponta com a cabine para o topo, por isso 0º = Norte.
  const truckMarkerRotation = driverBearing;

  const routeDistanceKm =
    parseGoogleDistanceKm(primaryRoute?.distanceText) ??
    (routeCoordinates.length > 1 ? getPolylineDistanceKm(routeCoordinates) : null);

  const trackedDistanceKm = getTrackedDistanceKm(locationHistory);

  const displayedTotalDistanceKm =
    currentTrip.total_distance_km ??
    routeDistanceKm;

  const displayedTraveledDistanceKm =
    currentTrip.traveled_distance_km ??
    (trackedDistanceKm > 0 ? trackedDistanceKm : 0);

  const displayedEstimatedTime =
    currentTrip.estimated_time ||
    primaryRoute?.durationText ||
    '—';

  const routeProgressSegments = splitRouteAtCurrentPosition(
    currentCoordinate,
    routeCoordinates,
    isTripStarted,
  );
  const nextStep = getNextNavigationStep(
    currentCoordinate,
    primaryRoute?.steps ?? [],
  );
  const currentRoadName =
    extractRoadNameFromInstruction(nextStep?.instruction) ??
    (
      primaryRoute?.summary &&
      primaryRoute.summary !== 'Google Maps'
        ? primaryRoute.summary
        : null
    ) ??
    'Estrada desconhecida';

  const calculatedProgress =
    displayedTotalDistanceKm != null &&
    displayedTotalDistanceKm > 0 &&
    displayedTraveledDistanceKm != null
      ? Math.max(
          0,
          Math.min(
            100,
            (displayedTraveledDistanceKm / displayedTotalDistanceKm) * 100,
          ),
        )
      : 0;

  const progress =
    currentStatus === 'concluida'
      ? 100
      : Math.max(getProgressValue(currentTrip), calculatedProgress);
  const canStartPickup = currentStatus === 'aguardando_inicio';
  const canArrivePickup = currentStatus === 'indo_carregar';
  const canConfirmLoaded = currentStatus === 'chegou_origem';
  const canStartDelivery = currentStatus === 'carregado';
  const distanceToDestination = navigationLocation && destinationCoordinate ? getDistanceKm(navigationLocation, destinationCoordinate) : null;
  const isNearDestination = distanceToDestination === null || distanceToDestination <= 0.02;
  const canArrive = currentStatus === 'viagem_iniciada';
  const showFooter = canStartPickup || canArrivePickup || canConfirmLoaded || canStartDelivery || currentStatus === 'viagem_iniciada';
  const coreJourneyStages = getJourneyStages(
    currentTrip,
    currentStatus,
  );
  const stopJourneyStages: JourneyStage[] = stops.map((stop) => ({
    key: `stop-${stop.id}`,
    title:
      stop.status === 'programada'
        ? `Paragem programada — ${stop.category_label}`
        : stop.status === 'em_andamento'
          ? `Paragem em andamento — ${stop.category_label}`
          : `Paragem concluída — ${stop.category_label}`,
    subtitle: `${stop.location_name} · ${stop.description}`,
    time:
      stop.completed_at ??
      stop.started_at ??
      stop.created_at,
    state:
      stop.status === 'concluida'
        ? 'completed'
        : stop.status === 'em_andamento'
          ? 'active'
          : 'upcoming',
  }));
  const journeyStages = [
    ...coreJourneyStages.slice(0, 4),
    ...stopJourneyStages,
    ...coreJourneyStages.slice(4),
  ];
  // For pickup phases point the map region towards origin; otherwise destination.
  const activeTarget = isHeadingToPickup ? originCoordinate : destinationCoordinate;
  const routeStartForRegion = originCoordinate ?? currentCoordinate;
  const routeEndForRegion = activeTarget ?? currentCoordinate;
  const initialLongitudeDelta = Math.max(Math.abs(routeStartForRegion.longitude - routeEndForRegion.longitude) * 1.4, 0.08);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <Pressable style={styles.headerBack} onPress={handleBack} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={FretixColors.white} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Detalhes da Viagem</Text>
            <Text style={styles.headerSub}>#{currentTrip.id} · {loadTitle}</Text>
          </View>
          <TripStatusBadge status={getTripStatus(currentStatus)} />
        </View>
      </SafeAreaView>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={PROVIDER_GOOGLE}
          mapType="standard"
          pitchEnabled
          rotateEnabled
          showsBuildings
          showsCompass={false}
          showsUserLocation={false}
          showsMyLocationButton={driverLocationPermissionGranted}
          initialRegion={{
            latitude: currentCoordinate.latitude,
            longitude: currentCoordinate.longitude,
            latitudeDelta: Math.max(Math.abs(routeStartForRegion.latitude - routeEndForRegion.latitude) * 1.4, 0.08),
            longitudeDelta: initialLongitudeDelta,
          }}
          onMapReady={() => setIsMapReady(true)}
          loadingEnabled
          loadingIndicatorColor={FretixColors.yellow}
          loadingBackgroundColor="#E5E7EB" 
        >
          {routeProgressSegments.remaining.length > 1 ? (
            <Polyline
              coordinates={routeProgressSegments.remaining}
              strokeColor="#FFC107"
              strokeWidth={7}
              lineCap="round"
              lineJoin="round"
              zIndex={4}
            />
          ) : null}
          {routeProgressSegments.traveled.length > 1 ? (
            <Polyline
              coordinates={routeProgressSegments.traveled}
              strokeColor="#8A94A3"
              strokeWidth={6}
              lineCap="round"
              lineJoin="round"
              zIndex={5}
            />
          ) : null}
          {!hasDrivingRoute && !routeLoading ? (
            <View />
          ) : null}
          {originCoordinate ? <Marker coordinate={originCoordinate} title="Origem" description={origin} pinColor="#3B82F6" zIndex={5} /> : null}
          {destinationCoordinate ? <Marker coordinate={destinationCoordinate} title="Destino" description={destination} pinColor={FretixColors.yellow} zIndex={6} /> : null}
          {liveMarker ? (
            <Marker.Animated
              coordinate={driverAnimatedCoordinate as any}
              title="Camião em movimento"
              description={
                currentTrip.vehicle?.plate
                  ? `Matrícula ${currentTrip.vehicle.plate}`
                  : 'Localização actual do motorista'
              }
              image={require('../../assets/truck_marker.png')}
              anchor={{ x: 0.5, y: 0.5 }}
              flat
              rotation={truckMarkerRotation}
              zIndex={20}
              tracksViewChanges={false}
            />
          ) : null}
        </MapView>

        {isTripStarted && !hasDrivingRoute && routeLoading ? (
          <View style={styles.routeRecalculatingBadge} pointerEvents="none">
            <ActivityIndicator size="small" color="#0B0F14" />
            <Text style={styles.routeRecalculatingText}>A calcular estrada...</Text>
          </View>
        ) : null}

        {isTripStarted ? (
          <View style={styles.navigationCard} pointerEvents="none">
            <View style={styles.navigationIcon}>
              <Ionicons name="navigate" size={22} color="#0B0F14" />
            </View>
            <View style={styles.navigationTexts}>
              <Text style={styles.navigationDistance}>
                {nextStep
                  ? `${nextStep.distanceKm < 1 ? Math.round(nextStep.distanceKm * 1000) : nextStep.distanceKm.toFixed(1)} ${nextStep.distanceKm < 1 ? 'm' : 'km'}`
                  : 'A guiar'}
              </Text>
              <Text style={styles.navigationInstruction} numberOfLines={2}>
                {nextStep?.instruction ?? `Siga para ${destination}`}
              </Text>
              <Text style={styles.navigationRoad} numberOfLines={1}>
                {currentRoadName}
              </Text>
            </View>
          </View>
        ) : null}

        {routeLoading || primaryRoute ? (
          <View style={styles.routeBadge} pointerEvents="none">
            {routeLoading ? (
              <ActivityIndicator size="small" color={FretixColors.yellow} />
            ) : (
              <Ionicons name="navigate" size={15} color={FretixColors.yellow} />
            )}
            <Text style={styles.routeBadgeText}>
              {routeLoading
                ? 'A calcular rota...'
                : `${primaryRoute?.distanceText ?? '—'} · ${primaryRoute?.durationText ?? '—'}`}
            </Text>
          </View>
        ) : null}

        <View style={styles.floatingMapControls} pointerEvents="box-none">
          <Pressable
            onPress={() => {
              mapRef.current?.animateCamera(
                {
                  center: currentCoordinate,
                  heading: 0,
                  pitch: is3DMode ? NAVIGATION_CAMERA_PITCH : 0,
                  zoom: isTripStarted ? NAVIGATION_CAMERA_ZOOM : undefined,
                },
                { duration: 650 },
              );
            }}
            style={styles.compassButton}
          >
            <Ionicons name="compass-outline" size={22} color={FretixColors.yellow} />
            <Text style={styles.compassText}>N</Text>
          </Pressable>
          <Pressable
            onPress={() => setIs3DMode((v) => !v)}
            style={[styles.mapModeButton, is3DMode && styles.mapModeButtonActive]}
          >
            <Ionicons name={is3DMode ? 'cube' : 'cube-outline'} size={18} color={is3DMode ? '#101217' : FretixColors.yellow} />
            <Text style={[styles.mapModeButtonText, is3DMode && styles.mapModeButtonTextActive]}>
              {is3DMode ? '3D' : '2D'}
            </Text>
          </Pressable>
        </View>
      </View>

      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...panResponder.panHandlers} style={styles.handleArea}>
          <View style={styles.handle} />
        </View>

        <Pressable onPress={toggleSheet} style={styles.summary}>
          <View style={styles.summaryRoute}>
            <View style={styles.summaryLoc}>
              <Ionicons name="location" size={15} color="#3B82F6" />
              <Text style={styles.summaryLocText} numberOfLines={1}>{origin}</Text>
            </View>
            <Ionicons name="arrow-forward" size={14} color={FretixColors.yellow} />
            <View style={styles.summaryLoc}>
              <Ionicons name="flag" size={15} color={FretixColors.yellow} />
              <Text style={styles.summaryLocText} numberOfLines={1}>{destination}</Text>
            </View>
          </View>
          <View style={styles.summaryMeta}>
            <View>
              <Text style={styles.metaLabel}>Saída</Text>
              <Text style={styles.metaValue}>{formatDate(load?.departure_date ?? currentTrip.departure_date ?? currentTrip.created_at)}</Text>
            </View>
            <View>
              <Text style={styles.metaLabel}>Estado</Text>
              <Text style={styles.metaValue}>{getTripStatusLabel(currentStatus)}</Text>
            </View>
            <View style={styles.expandHint}>
              <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-up'} size={18} color={FretixColors.yellow} />
            </View>
          </View>
        </Pressable>

        <ScrollView
          style={styles.detailsScroll}
          contentContainerStyle={[styles.detailsContent, showFooter && { paddingBottom: FOOTER_HEIGHT + 24 }]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={FretixColors.yellow} colors={[FretixColors.yellow]} />
          }
          showsVerticalScrollIndicator={false}
          scrollEnabled={isExpanded}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Progresso da Viagem</Text>
            <View style={styles.progressRow}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${progress}%` }]} />
              </View>
              <Text style={styles.progressText}>{Math.round(progress)}%</Text>
            </View>
            <View style={styles.metricsRow}>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Distância total</Text>
                <Text style={styles.metricValue}>{formatDistance(displayedTotalDistanceKm)}</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Percorrida</Text>
                <Text style={styles.metricValue}>{formatDistance(displayedTraveledDistanceKm)}</Text>
              </View>
              <View style={styles.metricCell}>
                <Text style={styles.metricLabel}>Tempo estimado</Text>
                <Text style={styles.metricValue}>{displayedEstimatedTime}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rota do Transporte</Text>
            {primaryRoute ? (
              <View style={styles.routeSuggestion}>
                <Ionicons name="sparkles" size={16} color={FretixColors.yellow} />
                <Text style={styles.routeSuggestionText}>
                  Google Maps: {primaryRoute.summary || 'rota sugerida'} · {primaryRoute.distanceText} · {primaryRoute.durationText}
                </Text>
              </View>
            ) : null}
            {primaryRoute ? (
              <View style={styles.roadNameRow}>
                <Ionicons name="trail-sign-outline" size={16} color={FretixColors.yellow} />
                <Text style={styles.roadNameText}>
                  Estrada actual: {currentRoadName}
                </Text>
              </View>
            ) : null}
            {routeError ? (
              <View style={styles.routeWarning}>
                <Ionicons name="warning-outline" size={16} color="#FCA5A5" />
                <Text style={styles.routeWarningText}>
                  Rota por estrada indisponivel. A linha reta aparece apenas como referencia.
                </Text>
              </View>
            ) : null}

            <View style={styles.realtimeSharingPanel}>
              <View style={styles.realtimeSharingHeader}>
                <Ionicons
                  name={isDriverLocationSharing ? 'radio' : 'radio-outline'}
                  size={16}
                  color={isDriverLocationSharing ? '#22C55E' : FretixColors.yellow}
                />
                <Text style={styles.realtimeSharingTitle}>Partilha de localização</Text>
              </View>
              <Text style={styles.realtimeSharingText}>
                {shouldTrackDriverLocation
                  ? isDriverLocationSharing
                    ? shouldPersistDriverLocation
                      ? 'GPS activo. A localização é enviada ao servidor quando a posição muda.'
                      : 'GPS activo para navegação até à origem. O envio ao servidor começa quando iniciar a viagem de entrega.'
                    : driverLocationSharingStatus === 'requesting_permission'
                      ? 'A solicitar permissão de localização...'
                      : driverLocationSharingStatus === 'error'
                        ? driverLocationError ?? 'Erro ao iniciar o rastreamento.'
                        : 'A iniciar o GPS...'
                  : 'O GPS de navegação é activado quando iniciar o deslocamento.'}
              </Text>
              {driverLocationLastSentAt ? (
                <Text style={styles.realtimeSharingMeta}>
                  Último envio ao servidor: {formatDateTime(driverLocationLastSentAt)}
                </Text>
              ) : null}
              {shouldTrackDriverLocation && !driverLocationPermissionGranted && driverLocationSharingStatus === 'error' ? (
                <Text style={styles.realtimeSharingWarning}>
                  Sem permissão, a empresa e o cliente não receberão a sua posição em tempo real.
                </Text>
              ) : null}
            </View>

            <View style={styles.currentLocationPanel}>
              <View style={styles.currentLocationHeader}>
                <View style={styles.currentLocationIcon}>
                  <Ionicons name="navigate" size={16} color="#101217" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.currentLocationTitle}>
                    {driverDeviceLocation || liveLocation ? 'Localização atual em tempo real' : 'Localização estimada'}
                  </Text>
                  <Text style={styles.currentLocationSubtitle}>
                    {currentPlaceLoading
                      ? 'A identificar província, cidade e bairro...'
                      : currentPlace?.name ?? (driverDeviceLocation || liveLocation ? 'Posição actual do motorista' : 'Ponto de origem')}
                  </Text>
                </View>
              </View>
              <View style={styles.locationGrid}>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Província</Text>
                  <Text style={styles.locationValue} numberOfLines={1}>{currentPlace?.province ?? '—'}</Text>
                </View>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Cidade/Distrito</Text>
                  <Text style={styles.locationValue} numberOfLines={1}>{currentPlace?.city ?? currentPlace?.district ?? '—'}</Text>
                </View>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Bairro/Zona</Text>
                  <Text style={styles.locationValue} numberOfLines={1}>{currentZoneLabel ?? 'Zona desconhecida'}</Text>
                </View>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Coordenadas</Text>
                  <Text style={styles.locationValue} numberOfLines={1}>{formatCoordinate(navigationLocation ?? currentCoordinate)}</Text>
                </View>
              </View>
              {lastLocationUpdateAt ? (
                <Text style={styles.currentLocationUpdatedAt}>
                  Atualizado em tempo real: {formatDateTime(lastLocationUpdateAt)}
                </Text>
              ) : null}
            </View>

            <View style={styles.routeContainer}>
              <View style={styles.routeMarkerCol}>
                <View style={styles.dotBlue} />
                <View style={styles.routeLine} />
                <View style={styles.dotYellow} />
              </View>
              <View style={styles.routeTextCol}>
                <View>
                  <Text style={styles.routeLabel}>Origem</Text>
                  <Text style={styles.routeValue}>{origin}</Text>
                </View>
                <View style={{ marginTop: 18 }}>
                  <Text style={styles.routeLabel}>Destino</Text>
                  <Text style={styles.routeValue}>{destination}</Text>
                </View>
              </View>
            </View>
          </View>

          {load ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Detalhes da Carga</Text>
              <View style={styles.rowInfo}>
                <LoadTypeImage loadType={load.load_type} style={styles.loadImg} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoName}>{load.load_name || `Carga de ${load.load_type}`}</Text>
                  {load.code ? <Text style={styles.infoSub}>Código: {load.code}</Text> : null}
                  {load.weight != null ? (
                    <Text style={styles.infoSub}>Peso: {load.weight} {load.weight_unit || 'kg'}</Text>
                  ) : null}
                </View>
              </View>
            </View>
          ) : null}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Cliente</Text>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Nome</Text>
              <Text style={styles.infoRowValue}>{currentTrip.client_name || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Telefone</Text>
              <Text style={styles.infoRowValue}>{currentTrip.client_phone || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Iniciada em</Text>
              <Text style={styles.infoRowValue}>{formatDateTime(currentTrip.started_at)}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoRowLabel}>Chegada</Text>
              <Text style={styles.infoRowValue}>{formatDateTime(currentTrip.arrived_at)}</Text>
            </View>
          </View>

          {(currentTrip.driver || currentTrip.vehicle) && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Motorista e Veículo</Text>
              {currentTrip.driver ? (
                <View style={styles.rowInfo}>
                  <Image
                    source={
                      currentTrip.driver.profile_photo
                        ? { uri: resolveMediaUrl(currentTrip.driver.profile_photo) ?? undefined }
                        : require('@/assets/images/splash-icon.png')
                    }
                    style={styles.avatar}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoName}>{currentTrip.driver.name || 'Motorista'}</Text>
                    {currentTrip.driver.phone ? <Text style={styles.infoSub}>Tel: {currentTrip.driver.phone}</Text> : null}
                  </View>
                </View>
              ) : null}
              {currentTrip.driver && currentTrip.vehicle ? <View style={styles.sep} /> : null}
              {currentTrip.vehicle ? (
                <View style={styles.rowInfo}>
                  <Image
                    source={
                      currentTrip.vehicle.photo
                        ? { uri: resolveMediaUrl(currentTrip.vehicle.photo) ?? undefined }
                        : require('@/assets/images/splash-icon.png')
                    }
                    style={styles.vehicleImg}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.infoName}>
                      {[currentTrip.vehicle.brand, currentTrip.vehicle.model_name].filter(Boolean).join(' ') || 'Caminhão'}
                    </Text>
                    <Text style={styles.infoPlate}>{currentTrip.vehicle.plate}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          )}

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>Paragens</Text>
              <Pressable
                onPress={() =>
                  pushWithReturnTo('/trip_stops', { id: currentTrip.id }, buildReturnTo('/trip_details', { id: currentTrip.id, returnTo }))
                }
              >
                <Text style={styles.linkText}>Ver todas</Text>
              </Pressable>
            </View>
            {stops.length === 0 ? (
              <Text style={styles.emptyText}>Nenhuma paragem registada ainda.</Text>
            ) : (
              stops.slice(0, 3).map((stop) => (
                <View key={stop.id} style={styles.stopRow}>
                  <Ionicons name="pause-circle-outline" size={18} color={FretixColors.yellow} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.stopTitle}>{stop.location_name || stop.category_label || stop.category}</Text>
                    <Text style={styles.stopSub}>{stop.category_label} · {stop.status === 'programada' ? 'Programada' : formatWaitDuration(stop.elapsed_seconds)}</Text>
                  </View>
                </View>
              ))
            )}
          </View>

          {/* ── Activity Road ── */}
          <View style={styles.card}>
            <View style={styles.activityHeaderRow}>
              <View>
                <Text style={styles.cardTitle}>Atividades da Viagem</Text>
              </View>
              <View style={styles.activityLegend}>
                <Ionicons name="checkmark-circle" size={16} color="#22C55E" />
                <Text style={styles.activityLegendText}>Concluída</Text>
              </View>
            </View>

            <View style={styles.activityRoadWrap}>
              {journeyStages.map((stage, index) => {
                const isLast = index === journeyStages.length - 1;
                const nextStage = journeyStages[index + 1];
                const roadCompleted =
                  stage.state === 'completed' &&
                  nextStage?.state !== 'upcoming';

                return (
                  <View key={stage.key} style={styles.activityRoadRow}>
                    <View style={styles.activityRoadColumn}>
                      {!isLast ? (
                        <>
                          <View style={styles.activityRoadBase} />
                          {roadCompleted ? (
                            <View style={styles.activityRoadCompleted} />
                          ) : null}
                        </>
                      ) : null}

                      {stage.state === 'completed' ? (
                        <View style={styles.activityCheckMarker}>
                          <Ionicons
                            name="checkmark"
                            size={17}
                            color="#FFFFFF"
                          />
                        </View>
                      ) : stage.state === 'active' ? (
                        <View style={styles.activityTruckMarker}>
                          <View style={styles.activityTruckHalo} />
                          <Image
                            source={require('../../assets/truck_marker.png')}
                            style={styles.activityTruckImage}
                            resizeMode="contain"
                          />
                        </View>
                      ) : (
                        <View style={styles.activityUpcomingMarker}>
                          <View style={styles.activityUpcomingDot} />
                        </View>
                      )}
                    </View>

                    <View
                      style={[
                        styles.activityStageCard,
                        stage.state === 'active' &&
                          styles.activityStageCardActive,
                      ]}
                    >
                      <View style={styles.activityStageTop}>
                        <Text
                          style={[
                            styles.activityStageTitle,
                            stage.state === 'completed' &&
                              styles.activityStageTitleCompleted,
                            stage.state === 'upcoming' &&
                              styles.activityStageTitleUpcoming,
                          ]}
                        >
                          {stage.title}
                        </Text>

                        {stage.state === 'active' ? (
                          <View style={styles.activityActiveBadge}>
                            <View style={styles.activityActivePulse} />
                            <Text style={styles.activityActiveBadgeText}>
                              Em curso
                            </Text>
                          </View>
                        ) : null}
                      </View>

                      <Text
                        style={[
                          styles.activityStageSubtitle,
                          stage.state === 'upcoming' &&
                            styles.activityStageSubtitleUpcoming,
                        ]}
                      >
                        {stage.subtitle}
                      </Text>

                      {stage.time ? (
                        <Text style={styles.activityStageTime}>
                          {formatDateTime(stage.time)}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {showFooter ? (
          <View style={styles.footer}>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() =>
                pushWithReturnTo('/trip_stops', { id: currentTrip.id }, buildReturnTo('/trip_details', { id: currentTrip.id, returnTo }))
              }
            >
              <Ionicons name="add-circle-outline" size={18} color={FretixColors.white} />
              <Text style={styles.secondaryBtnText}>Paragem</Text>
            </Pressable>

            {/* Step 1: Ir buscar a carga */}
            {canStartPickup ? (
              <Pressable style={[styles.primaryBtn]} onPress={handleStartPickup} disabled={starting}>
                {starting ? (
                  <ActivityIndicator color="#101217" />
                ) : (
                  <>
                    <Ionicons name="navigate" size={18} color="#101217" />
                    <Text style={styles.primaryBtnText}>Indo Carregar</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {/* Step 2: Confirmação de chegada à origem */}
            {canArrivePickup ? (
              <Pressable style={[styles.primaryBtn]} onPress={handleArrivePickup} disabled={starting}>
                {starting ? (
                  <ActivityIndicator color="#101217" />
                ) : (
                  <>
                    <Ionicons name="location" size={18} color="#fff" />
                    <Text style={[styles.primaryBtnText, { color: '#fff' }]}>Cheguei à Origem</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {/* Step 3: Confirmar carregamento */}
            {canConfirmLoaded ? (
              <Pressable style={[styles.primaryBtn, styles.primaryBtnLoaded]} onPress={handleConfirmLoaded} disabled={starting}>
                {starting ? (
                  <ActivityIndicator color="#101217" />
                ) : (
                  <>
                    <Ionicons name="cube" size={18} color="#101217" />
                    <Text style={styles.primaryBtnText}>Confirmar Carregamento</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {/* Step 4: Iniciar viagem de entrega */}
            {canStartDelivery ? (
              <Pressable style={styles.primaryBtn} onPress={handleStartTrip} disabled={starting}>
                {starting ? (
                  <ActivityIndicator color="#101217" />
                ) : (
                  <>
                    <Ionicons name="play" size={18} color="#101217" />
                    <Text style={styles.primaryBtnText}>Iniciar Entrega</Text>
                  </>
                )}
              </Pressable>
            ) : null}

            {/* Step 5: Chegada ao destino */}
            {canArrive ? (
              <Pressable
                style={styles.primaryBtn}
                onPress={() =>
                  pushWithReturnTo(
                    '/trip_arrival_confirm',
                    { id: currentTrip.id },
                    buildReturnTo('/trip_details', { id: currentTrip.id, returnTo }),
                  )
                }
              >
                <Ionicons name="flag" size={18} color="#101217" />
                <Text style={styles.primaryBtnText}>Confirmar Chegada</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </Animated.View>

      <CustomDialog
        visible={dialogVisible}
        title={dialogProps.title}
        message={dialogProps.message}
        type={dialogProps.type}
        onConfirm={() => setDialogVisible(false)}
        onCancel={() => setDialogVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B0F14' },
  loaderContainer: {
    flex: 1,
    backgroundColor: FretixColors.black,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loaderText: { color: FretixColors.grayLight, fontSize: 14 },
  backBtn: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: FretixColors.yellow,
  },
  backBtnText: { color: FretixColors.yellow, fontSize: 14, fontWeight: '600' },
  headerSafe: { zIndex: 20, elevation: 20, backgroundColor: '#0B0F14' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
    backgroundColor: 'rgba(11,15,20,0.96)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerBack: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 20 },
  headerCenter: { flex: 1 },
  headerTitle: { color: FretixColors.white, fontSize: 15, fontWeight: '700' },
  headerSub: { color: '#8D949E', fontSize: 12, marginTop: 1 },
  mapWrap: { flex: 1, position: 'relative' },
  routeRecalculatingBadge: {
    position: 'absolute',
    top: 16,
    alignSelf: 'center',
    zIndex: 20,
    minHeight: 38,
    borderRadius: 999,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: FretixColors.yellow,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  routeRecalculatingText: {
    color: '#0B0F14',
    fontSize: 12,
    fontWeight: '900',
  },
  navigationCard: {
    position: 'absolute',
    top: 12,
    left: 14,
    right: 14,
    zIndex: 10,
    elevation: 10,
    minHeight: 74,
    borderRadius: 18,
    backgroundColor: 'rgba(7,10,14,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.28)',
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  navigationIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navigationTexts: { flex: 1 },
  navigationDistance: { color: FretixColors.yellow, fontSize: 13, fontWeight: '900', marginBottom: 3 },
  navigationInstruction: { color: FretixColors.white, fontSize: 16, fontWeight: '800', lineHeight: 20 },
  navigationRoad: { color: '#AAB2BE', fontSize: 12, fontWeight: '700', marginTop: 3 },
  truckMarkerWrap: {
    width: 46,
    height: 86,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 12,
  },
  truckMarkerImage: {
    width: 42,
    height: 82,
  },
  destinationPlaceLabel: {
    maxWidth: 145,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.75)',
  },
  destinationMarkerLabel: {
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: FretixColors.yellow,
    borderRadius: 9,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  destinationMarkerLabelText: {
    flexShrink: 1,
    color: '#0B0F14',
    fontSize: 11,
    fontWeight: '800',
  },
  destinationPlaceLabelText: {
    flexShrink: 1,
    color: '#0B0F14',
    fontSize: 10,
    fontWeight: '700',
  },
  routeBadge: {
    position: 'absolute',
    top: 94,
    alignSelf: 'center',
    zIndex: 9,
    elevation: 9,
    minHeight: 34,
    maxWidth: '86%',
    borderRadius: 17,
    backgroundColor: 'rgba(11,15,20,0.82)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.35)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeBadgeText: { color: FretixColors.white, fontSize: 12, fontWeight: '700' },
  floatingMapControls: {
    position: 'absolute',
    bottom: COLLAPSED_HEIGHT + 14,
    right: 16,
    zIndex: 9,
    elevation: 9,
    alignItems: 'center',
    gap: 10,
  },
  compassButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(11,15,20,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compassText: { position: 'absolute', top: 4, color: FretixColors.yellow, fontSize: 9, fontWeight: '900' },
  mapModeButton: {
    minWidth: 62,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(11,15,20,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.38)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  mapModeButtonActive: { backgroundColor: FretixColors.yellow, borderColor: FretixColors.yellow },
  mapModeButtonText: { color: FretixColors.yellow, fontSize: 12, fontWeight: '800' },
  mapModeButtonTextActive: { color: '#101217' },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 15,
    elevation: 15,
    backgroundColor: '#0E1621',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  handleArea: { alignItems: 'center', paddingVertical: 10 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  summary: { paddingHorizontal: 20, paddingBottom: 14, gap: 12 },
  summaryRoute: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryLoc: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  summaryLocText: { flex: 1, color: FretixColors.white, fontSize: 13, fontWeight: '600' },
  summaryMeta: { flexDirection: 'row', alignItems: 'center', gap: 20 },
  metaLabel: { color: '#6B7280', fontSize: 11 },
  metaValue: { color: FretixColors.white, fontSize: 13, fontWeight: '700', marginTop: 2 },
  expandHint: { marginLeft: 'auto' },
  detailsScroll: { flex: 1 },
  detailsContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 12 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    color: FretixColors.white,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    opacity: 0.6,
  },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTrack: { flex: 1, height: 8, borderRadius: 999, backgroundColor: '#1E293B', overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: FretixColors.yellow },
  progressText: { color: FretixColors.yellow, fontSize: 13, fontWeight: '700', minWidth: 36 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCell: {
    flexBasis: '30%',
    flexGrow: 1,
    borderRadius: 10,
    backgroundColor: 'rgba(11,15,20,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    padding: 10,
    gap: 4,
  },
  metricLabel: { color: '#8D949E', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  metricValue: { color: FretixColors.white, fontSize: 13, fontWeight: '700' },
  routeSuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(255,193,7,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.18)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  routeSuggestionText: { flex: 1, color: FretixColors.white, fontSize: 12, fontWeight: '600' },
  routeWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.22)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  routeWarningText: { flex: 1, color: '#FECACA', fontSize: 12, fontWeight: '700', lineHeight: 16 },
  roadNameRow: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255,193,7,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.18)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roadNameText: {
    flex: 1,
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '700',
  },
  realtimeSharingPanel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(17,24,36,0.65)',
    padding: 12,
    gap: 6,
  },
  realtimeSharingHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  realtimeSharingTitle: { color: FretixColors.white, fontSize: 13, fontWeight: '700' },
  realtimeSharingText: { color: '#C9D1D9', fontSize: 12, lineHeight: 18 },
  realtimeSharingMeta: { color: '#93C5FD', fontSize: 11, fontWeight: '700' },
  realtimeSharingWarning: { color: '#FCA5A5', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  currentLocationPanel: {
    gap: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.24)',
    padding: 12,
  },
  currentLocationHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  currentLocationIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLocationTitle: { color: FretixColors.white, fontSize: 13, fontWeight: '800' },
  currentLocationSubtitle: { color: '#AAB2BE', fontSize: 12, marginTop: 2 },
  locationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  locationCell: {
    width: '48%',
    minHeight: 50,
    borderRadius: 10,
    backgroundColor: 'rgba(11,15,20,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    paddingHorizontal: 10,
    paddingVertical: 8,
    justifyContent: 'center',
  },
  locationLabel: { color: '#8D949E', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  locationValue: { color: FretixColors.white, fontSize: 12, fontWeight: '700', marginTop: 3 },
  currentLocationUpdatedAt: { color: FretixColors.yellow, fontSize: 11, fontWeight: '700' },
  routeContainer: { flexDirection: 'row', gap: 12 },
  routeMarkerCol: { alignItems: 'center', paddingTop: 4 },
  dotBlue: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#3B82F6' },
  routeLine: { flex: 1, width: 2, backgroundColor: '#374151', marginVertical: 4, minHeight: 28 },
  dotYellow: { width: 10, height: 10, borderRadius: 5, backgroundColor: FretixColors.yellow },
  routeTextCol: { flex: 1 },
  routeLabel: { color: '#8D949E', fontSize: 11 },
  routeValue: { color: FretixColors.white, fontSize: 14, fontWeight: '600', marginTop: 2 },
  rowInfo: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  loadImg: { width: 46, height: 46, borderRadius: 10 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#0D1118' },
  vehicleImg: { width: 56, height: 46, borderRadius: 10, backgroundColor: '#0D1118' },
  infoName: { color: FretixColors.white, fontSize: 14, fontWeight: '700' },
  infoSub: { color: '#8D949E', fontSize: 12, marginTop: 2 },
  infoPlate: { color: FretixColors.yellow, fontSize: 12, fontWeight: '700', marginTop: 2 },
  priceWrap: { alignItems: 'flex-end' },
  priceText: { color: FretixColors.white, fontSize: 14, fontWeight: '700' },
  negotiable: { color: FretixColors.yellow, fontSize: 10, fontWeight: '600', marginTop: 2 },
  sep: { height: 1, backgroundColor: 'rgba(255,255,255,0.07)', marginVertical: 4 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoRowLabel: { color: '#8D949E', fontSize: 13 },
  infoRowValue: { color: FretixColors.white, fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  linkText: { color: FretixColors.yellow, fontSize: 13, fontWeight: '700' },
  emptyText: { color: FretixColors.grayLight, fontSize: 13 },
  stopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  stopTitle: { color: FretixColors.white, fontSize: 14, fontWeight: '700' },
  stopSub: { color: '#8D949E', fontSize: 12, marginTop: 2 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 18,
    backgroundColor: '#0E1621',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
  },
  primaryBtn: {
    minHeight: 50,
    backgroundColor: FretixColors.yellow,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flex: 2,
  },
  primaryBtnText: { color: '#101217', fontSize: 15, fontWeight: '700' },
  primaryBtnPickup: {
    backgroundColor: '#8B5CF6',
  },
  primaryBtnArrive: {
    backgroundColor: '#EC4899',
  },
  primaryBtnLoaded: {
    backgroundColor: '#10B981',
  },
  secondaryBtn: {
    minHeight: 50,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    flex: 1,
  },
  secondaryBtnText: { color: FretixColors.white, fontSize: 15, fontWeight: '700' },
  // Activity Road
  activityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  activityHeaderSubtitle: {
    color: '#7F8996',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  activityLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)',
  },
  activityLegendText: {
    color: '#86EFAC',
    fontSize: 10,
    fontWeight: '800',
  },
  activityRoadWrap: {
    marginTop: 18,
  },
  activityRoadRow: {
    minHeight: 94,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  activityRoadColumn: {
    width: 52,
    alignItems: 'center',
    position: 'relative',
  },
  activityRoadBase: {
    position: 'absolute',
    top: 30,
    bottom: -6,
    width: 7,
    borderRadius: 999,
    backgroundColor: '#35404D',
  },
  activityRoadCompleted: {
    position: 'absolute',
    top: 30,
    bottom: -6,
    width: 7,
    borderRadius: 999,
    backgroundColor: '#22C55E',
  },
  activityCheckMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#22C55E',
    borderWidth: 3,
    borderColor: '#DDFBE7',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
    shadowColor: '#22C55E',
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  activityTruckMarker: {
    width: 44,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 8,
    marginTop: -10,
  },
  activityTruckHalo: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,193,7,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.42)',
  },
  activityTruckImage: {
    width: 27,
    height: 52,
    // Na linha de actividades o percurso visual avança de cima para baixo.
    // O camião deve apontar para baixo para transmitir que está a avançar
    // para a próxima etapa, e não a regressar às etapas concluídas.
    transform: [{ rotate: '180deg' }],
  },
  activityUpcomingMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#121923',
    borderWidth: 2,
    borderColor: '#4B5563',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 5,
  },
  activityUpcomingDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#6B7280',
  },
  activityStageCard: {
    flex: 1,
    minHeight: 74,
    marginLeft: 6,
    marginBottom: 16,
    borderRadius: 14,
    paddingVertical: 11,
    paddingHorizontal: 13,
    backgroundColor: '#0E151E',
    borderWidth: 1,
    borderColor: '#212C39',
  },
  activityStageCardActive: {
    backgroundColor: 'rgba(255,193,7,0.065)',
    borderColor: 'rgba(255,193,7,0.36)',
  },
  activityStageTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  activityStageTitle: {
    flex: 1,
    color: FretixColors.white,
    fontSize: 13,
    fontWeight: '800',
  },
  activityStageTitleCompleted: {
    color: '#BBF7D0',
  },
  activityStageTitleUpcoming: {
    color: '#7D8793',
  },
  activityStageSubtitle: {
    color: '#A6AFBA',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  activityStageSubtitleUpcoming: {
    color: '#606B78',
  },
  activityStageTime: {
    color: '#6E7A88',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 5,
  },
  activityActiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,193,7,0.13)',
  },
  activityActivePulse: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: FretixColors.yellow,
  },
  activityActiveBadgeText: {
    color: FretixColors.yellow,
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
});
