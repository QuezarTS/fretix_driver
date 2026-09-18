import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LoadTypeImage } from '@/components/load-type-image';
import { TopAppHeader } from '@/components/top-app-header';
import {
  TripStatusBadge,
  type LoadStatusType,
} from '@/components/trip-status-indicator';
import { BottomTabInset, FretixColors } from '@/constants/theme';
import { useWebSocket } from '@/context/WebSocketContext';
import { tripService, type Trip } from '@/services/trips';
import { resolveMediaUrl } from '@/utils/media-url';
import { buildReturnTo, pushWithReturnTo } from '@/utils/navigation';

type TripTab = 'Todas' | 'Em andamento' | 'Concluídas' | 'Canceladas';

const tabs: Array<{
  label: TripTab;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { label: 'Todas', icon: 'albums-outline' },
  { label: 'Em andamento', icon: 'navigate-outline' },
  { label: 'Concluídas', icon: 'checkmark-done-outline' },
  { label: 'Canceladas', icon: 'close-circle-outline' },
];

const normalizeStatus = (value?: string | null) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

const COMPLETED_STATUSES = new Set([
  'concluida',
  'concluido',
  'completed',
  'complete',
  'finalizada',
  'finalizado',
]);

const isCompletedTrip = (trip: Trip) =>
  COMPLETED_STATUSES.has(normalizeStatus(trip.status)) ||
  Boolean(trip.completed_at) ||
  Boolean(trip.client_confirmed_at);

const isCancelledTrip = (trip: Trip) =>
  normalizeStatus(trip.status) === 'cancelado';

const isOngoingTrip = (trip: Trip) =>
  !isCompletedTrip(trip) && !isCancelledTrip(trip);

const mapTripStatus = (trip: Trip): LoadStatusType => {
  if (isCompletedTrip(trip)) return 'concluido';

  switch (normalizeStatus(trip.status)) {
    case 'aguardando_inicio':
      return 'disponivel';
    case 'indo_carregar':
      return 'indo_carregar';
    case 'chegou_origem':
      return 'chegou_origem';
    case 'carregado':
      return 'carregado';
    case 'viagem_iniciada':
      return 'em_viagem';
    case 'aguardando_cliente':
      return 'em_andamento';
    case 'cancelado':
      return 'cancelado';
    default:
      return 'disponivel';
  }
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';

  return new Date(value).toLocaleDateString('pt-MZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const formatDistance = (value?: number | null) => {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(1)} km`;
};

export default function TripsScreen() {
  const { addListenerForTypes } = useWebSocket();

  const [trips, setTrips] = useState<Trip[]>([]);
  const [activeTab, setActiveTab] = useState<TripTab>('Todas');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadedOnceRef = useRef(false);

  const loadTrips = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);

      const [allResult, completedResult] = await Promise.allSettled([
        tripService.getMyTrips(),
        tripService.getMyTrips('concluidas'),
      ]);

      const allTrips =
        allResult.status === 'fulfilled' ? allResult.value : [];
      const completedTrips =
        completedResult.status === 'fulfilled' ? completedResult.value : [];

      const mergedById = new Map<number, Trip>();

      for (const item of [...allTrips, ...completedTrips]) {
        const previous = mergedById.get(item.id);
        mergedById.set(item.id, previous ? { ...previous, ...item } : item);
      }

      const data = [...mergedById.values()];

      // Mais recentes primeiro; quando uma viagem for concluída,
      // completed_at passa a ser a referência principal.
      const sorted = [...data].sort((a, b) => {
        const aDate =
          a.completed_at ??
          a.client_confirmed_at ??
          a.started_at ??
          a.created_at;
        const bDate =
          b.completed_at ??
          b.client_confirmed_at ??
          b.started_at ??
          b.created_at;

        return new Date(bDate).getTime() - new Date(aDate).getTime();
      });

      setTrips(sorted);
      loadedOnceRef.current = true;
    } catch (error) {
      console.error('Failed to load trips:', error);

      if (!loadedOnceRef.current) {
        setTrips([]);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Recarrega sempre que o motorista volta a esta tela.
  // Assim, se o cliente confirmou a entrega enquanto o motorista estava
  // noutra página, a viagem entra em "Concluídas" sem fechar o app.
  useFocusEffect(
    useCallback(() => {
      void loadTrips(loadedOnceRef.current);

      const interval = setInterval(
        () => void loadTrips(true),
        8_000,
      );

      return () => clearInterval(interval);
    }, [loadTrips]),
  );

  useEffect(() => {
    const unsubscribe = addListenerForTypes(
      ['trip.status_changed', 'trip.location', 'trip.assigned'],
      (event) => {
        if (typeof event.trip_id !== 'number') return;

        if (event.type === 'trip.assigned') {
          void loadTrips(true);
          return;
        }

        setTrips((currentTrips) =>
          currentTrips.map((trip) => {
            if (trip.id !== event.trip_id) return trip;

            if (
              event.type === 'trip.status_changed' &&
              typeof event.status === 'string'
            ) {
              return {
                ...trip,
                status: event.status,
              };
            }

            if (event.type === 'trip.location') {
              return {
                ...trip,
                status:
                  typeof event.status === 'string'
                    ? event.status
                    : trip.status,
              };
            }

            return trip;
          }),
        );

        // Um status final pode trazer completed_at/client_confirmed_at apenas
        // no GET mais recente. Fazemos um refresh silencioso para sincronizar.
        if (
          event.type === 'trip.status_changed' &&
          typeof event.status === 'string' &&
          normalizeStatus(event.status) === 'concluida'
        ) {
          void loadTrips(true);
        }
      },
    );

    return unsubscribe;
  }, [addListenerForTypes, loadTrips]);

  const onRefresh = () => {
    setRefreshing(true);
    void loadTrips(true);
  };

  const filteredTrips = useMemo(() => {
    switch (activeTab) {
      case 'Em andamento':
        return trips.filter(isOngoingTrip);
      case 'Concluídas':
        return trips.filter(isCompletedTrip);
      case 'Canceladas':
        return trips.filter(isCancelledTrip);
      case 'Todas':
      default:
        return trips;
    }
  }, [activeTab, trips]);

  const counts = useMemo(
    () => ({
      Todas: trips.length,
      'Em andamento': trips.filter(isOngoingTrip).length,
      Concluídas: trips.filter(isCompletedTrip).length,
      Canceladas: trips.filter(isCancelledTrip).length,
    }),
    [trips],
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <TopAppHeader />

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Viagens</Text>
            <Text style={styles.subtitle}>
              Acompanhe deslocamentos, entregas e histórico.
            </Text>
          </View>

          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {filteredTrips.length} viagens
            </Text>
          </View>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContainer}
          style={styles.tabsScroll}
        >
          {tabs.map((tab) => {
            const active = tab.label === activeTab;

            return (
              <Pressable
                key={tab.label}
                style={[styles.tabPill, active && styles.tabPillActive]}
                onPress={() => setActiveTab(tab.label)}
              >
                <Ionicons
                  name={tab.icon}
                  size={14}
                  color={active ? '#101217' : '#AAB2BE'}
                />
                <Text
                  style={[styles.tabText, active && styles.tabTextActive]}
                >
                  {tab.label}
                </Text>
                <View
                  style={[
                    styles.tabCount,
                    active && styles.tabCountActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.tabCountText,
                      active && styles.tabCountTextActive,
                    ]}
                  >
                    {counts[tab.label]}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>

        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator
              size="large"
              color={FretixColors.yellow}
            />
          </View>
        ) : (
          <FlatList
            data={filteredTrips}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={FretixColors.yellow}
                colors={[FretixColors.yellow]}
              />
            }
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons
                  name={
                    activeTab === 'Concluídas'
                      ? 'checkmark-done-outline'
                      : 'car-outline'
                  }
                  size={48}
                  color={FretixColors.grayLight}
                />
                <Text style={styles.emptyTitle}>
                  Nenhuma viagem encontrada
                </Text>
                <Text style={styles.emptySubtitle}>
                  {activeTab === 'Concluídas'
                    ? 'Quando o cliente confirmar a entrega, a viagem aparecerá aqui.'
                    : 'As viagens atribuídas ao seu perfil ou camião aparecerão aqui.'}
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const vehiclePhoto = item.vehicle?.photo
                ? resolveMediaUrl(item.vehicle.photo)
                : null;

              const title =
                item.load?.load_name ||
                item.load?.description ||
                (item.load?.load_type
                  ? `Carga de ${item.load.load_type}`
                  : `Viagem #${item.id}`);

              return (
                <Pressable
                  style={styles.card}
                  onPress={() =>
                    pushWithReturnTo(
                      '/trip_details',
                      { id: item.id },
                      buildReturnTo('/trips'),
                    )
                  }
                >
                  <View style={styles.cardTopRow}>
                    <View style={styles.imgWrap}>
                      <Image
                        source={
                          vehiclePhoto
                            ? { uri: vehiclePhoto }
                            : require('../../assets/camiao_cover.png')
                        }
                        style={styles.img}
                        resizeMode="cover"
                      />

                      <View style={styles.imgBadge}>
                        <LoadTypeImage
                          loadType={
                            item.load?.load_type ??
                            item.load_type ??
                            ''
                          }
                          style={styles.imgBadgeImg}
                          fallbackIconSize={14}
                        />
                      </View>
                    </View>

                    <View style={styles.cardInfoRow}>
                      <Text style={styles.cardTitle} numberOfLines={1}>
                        {title}
                      </Text>
                      <Text style={styles.cardSubtitle} numberOfLines={1}>
                        #{item.id}
                        {item.vehicle?.plate
                          ? ` · ${item.vehicle.plate}`
                          : item.load_code
                            ? ` · ${item.load_code}`
                            : ''}
                      </Text>
                    </View>

                    <TripStatusBadge status={mapTripStatus(item)} />
                  </View>

                  <View style={styles.routeRow}>
                    <View style={styles.routePointBlue} />
                    <Text style={styles.routeText} numberOfLines={1}>
                      {item.load?.origin ?? item.origin}
                    </Text>
                    <Ionicons
                      name="arrow-forward"
                      size={15}
                      color={FretixColors.yellow}
                    />
                    <View style={styles.routePointYellow} />
                    <Text style={styles.routeText} numberOfLines={1}>
                      {item.load?.destination ?? item.destination}
                    </Text>
                  </View>

                  <View style={styles.cardMeta}>
                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Distância</Text>
                      <Text style={styles.metaValue}>
                        {formatDistance(item.total_distance_km)}
                      </Text>
                    </View>

                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>Percorrida</Text>
                      <Text style={styles.metaValue}>
                        {formatDistance(item.traveled_distance_km)}
                      </Text>
                    </View>

                    <View style={styles.metaItem}>
                      <Text style={styles.metaLabel}>
                        {isCompletedTrip(item)
                          ? 'Concluída'
                          : 'Saída'}
                      </Text>
                      <Text style={styles.metaValue}>
                        {formatDate(
                          isCompletedTrip(item)
                            ? item.completed_at ??
                                item.client_confirmed_at
                            : item.departure_date ??
                                item.load?.departure_date ??
                                item.started_at ??
                                item.created_at,
                        )}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              );
            }}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FretixColors.black,
  },
  safeArea: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    color: FretixColors.white,
    fontSize: 24,
    fontWeight: '800',
  },
  subtitle: {
    color: FretixColors.grayLight,
    fontSize: 13,
    marginTop: 4,
  },
  badge: {
    backgroundColor: '#111824',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#273241',
  },
  badgeText: {
    color: FretixColors.white,
    fontSize: 11,
    fontWeight: '800',
  },
  tabsScroll: {
    marginHorizontal: 16,
    marginBottom: 14,
    maxHeight: 46,
    flexShrink: 0,
  },
  tabsContainer: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
  },
  tabPill: {
    height: 38,
    borderRadius: 999,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#111723',
    borderWidth: 1,
    borderColor: '#263242',
  },
  tabPillActive: {
    backgroundColor: FretixColors.yellow,
    borderColor: FretixColors.yellow,
  },
  tabText: {
    color: '#AAB2BE',
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#101217',
  },
  tabCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1D2835',
  },
  tabCountActive: {
    backgroundColor: 'rgba(11,15,20,0.18)',
  },
  tabCountText: {
    color: '#CBD5E1',
    fontSize: 10,
    fontWeight: '800',
  },
  tabCountTextActive: {
    color: '#101217',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: BottomTabInset + 16,
    gap: 12,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    marginTop: 80,
    gap: 10,
  },
  emptyTitle: {
    color: FretixColors.white,
    fontSize: 18,
    fontWeight: '800',
    marginTop: 8,
  },
  emptySubtitle: {
    color: FretixColors.grayLight,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#111824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#273241',
    padding: 15,
    gap: 14,
  },
  cardTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  imgWrap: {
    width: 64,
    height: 64,
    position: 'relative',
    flexShrink: 0,
  },
  img: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#0D1118',
  },
  imgBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#131E2C',
    borderWidth: 2,
    borderColor: '#2A3A50',
    overflow: 'hidden',
  },
  imgBadgeImg: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
  },
  cardInfoRow: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  cardTitle: {
    color: FretixColors.white,
    fontSize: 15,
    fontWeight: '800',
  },
  cardSubtitle: {
    color: FretixColors.grayLight,
    fontSize: 12,
    fontWeight: '600',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  routePointBlue: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
  },
  routePointYellow: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: FretixColors.yellow,
  },
  routeText: {
    flex: 1,
    color: '#E5E7EB',
    fontSize: 12,
    fontWeight: '600',
  },
  cardMeta: {
    flexDirection: 'row',
    gap: 8,
  },
  metaItem: {
    flex: 1,
    backgroundColor: '#0E151E',
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#1F2A38',
    paddingHorizontal: 10,
    paddingVertical: 9,
    gap: 3,
  },
  metaLabel: {
    color: '#7E8794',
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  metaValue: {
    color: FretixColors.white,
    fontSize: 11,
    fontWeight: '800',
  },
});
