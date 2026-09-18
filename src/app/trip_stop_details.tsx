import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FretixColors } from '@/constants/theme';
import { useWebSocket } from '@/context/WebSocketContext';
import {
  tripService,
  type TripStop,
} from '@/services/trips';
import {
  goBackSmart,
  useSmartBackHandler,
} from '@/utils/navigation';

const GRACE_SECONDS = 24 * 60 * 60;

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds || 0));
  const days = Math.floor(safe / 86400);
  const hours = Math.floor((safe % 86400) / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}min`;
  if (hours > 0) return `${hours}h ${minutes}min`;
  if (minutes > 0) return `${minutes}min ${secs}s`;
  return `${secs}s`;
}

function getLiveElapsed(stop: TripStop, now: number) {
  if (!stop.started_at) return 0;
  const start = new Date(stop.started_at).getTime();
  const end = stop.completed_at
    ? new Date(stop.completed_at).getTime()
    : now;
  return Math.max(
    Number(stop.elapsed_seconds || 0),
    Math.floor((end - start) / 1000),
  );
}

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-MZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TripStopDetailsScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    stopId?: string | string[];
    returnTo?: string | string[];
    from?: string | string[];
  }>();

  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawStopId = Array.isArray(params.stopId)
    ? params.stopId[0]
    : params.stopId;
  const returnTo = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const from = Array.isArray(params.from)
    ? params.from[0]
    : params.from;

  const tripId = rawId ? Number(rawId) : null;
  const stopId = rawStopId ? Number(rawStopId) : null;

  const { addListenerForTypes } = useWebSocket();

  const [stop, setStop] = useState<TripStop | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useSmartBackHandler({
    returnTo,
    from,
    fallback: tripId
      ? `/trip_stops?id=${tripId}`
      : '/trips',
  });

  const load = useCallback(async () => {
    if (!tripId || !stopId) return;

    try {
      setError(null);
      const rows = await tripService.getTripStops(tripId);
      setStop(
        rows.find((item) => item.id === stopId) ?? null,
      );
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          'Não foi possível carregar a paragem.',
      );
    } finally {
      setLoading(false);
    }
  }, [tripId, stopId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const interval = setInterval(
      () => setNow(Date.now()),
      1000,
    );
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!tripId) return;

    return addListenerForTypes(
      [
        'trip.stop_scheduled',
        'trip.stop_started',
        'trip.stop_completed',
        'trip.delay_fee_started',
      ],
      (event) => {
        if (
          event.trip_id == null ||
          Number(event.trip_id) === tripId
        ) {
          void load();
        }
      },
    );
  }, [tripId, addListenerForTypes, load]);

  const start = async () => {
    if (!tripId || !stop) return;
    try {
      setWorking(true);
      await tripService.startTripStop(tripId, stop.id);
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          'Não foi possível iniciar a paragem.',
      );
    } finally {
      setWorking(false);
    }
  };

  const complete = async () => {
    if (!tripId || !stop) return;
    try {
      setWorking(true);
      await tripService.completeTripStop(tripId, stop.id);
      await load();
    } catch (err: any) {
      setError(
        err?.response?.data?.detail ||
          'Não foi possível concluir a paragem.',
      );
    } finally {
      setWorking(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator
          size="large"
          color={FretixColors.yellow}
        />
      </View>
    );
  }

  if (!stop) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {error || 'Paragem não encontrada.'}
        </Text>
      </View>
    );
  }

  const elapsed = getLiveElapsed(stop, now);
  const remaining = Math.max(
    0,
    GRACE_SECONDS - elapsed,
  );
  const overtime = Math.max(
    0,
    elapsed - GRACE_SECONDS,
  );

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable
            style={styles.back}
            onPress={() =>
              goBackSmart({
                returnTo,
                from,
                fallback: '/trips',
              })
            }>
            <Ionicons
              name="arrow-back"
              size={22}
              color={FretixColors.white}
            />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              Detalhes da paragem
            </Text>
            <Text style={styles.subtitle}>
              Viagem #{tripId}
            </Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}>
          <View style={styles.card}>
            <Text style={styles.category}>
              {stop.category_label || stop.category}
            </Text>
            <Text style={styles.location}>
              {stop.location_name}
            </Text>
            <Text style={styles.description}>
              {stop.description}
            </Text>
          </View>

          <View style={styles.timerCard}>
            <Text style={styles.timerLabel}>
              Tempo de espera
            </Text>
            <Text style={styles.timerValue}>
              {stop.status === 'programada'
                ? 'Ainda não iniciado'
                : formatDuration(elapsed)}
            </Text>

            {stop.status !== 'programada' ? (
              elapsed <= GRACE_SECONDS ? (
                <Text style={styles.hint}>
                  Tempo gratuito restante:{' '}
                  {formatDuration(remaining)}
                </Text>
              ) : (
                <>
                  <Text style={styles.warning}>
                    Período gratuito de 24 horas
                    ultrapassado
                  </Text>
                  <Text style={styles.hint}>
                    Tempo após 24h:{' '}
                    {formatDuration(overtime)}
                  </Text>
                </>
              )
            ) : (
              <Text style={styles.hint}>
                O tempo começa apenas quando iniciar
                a paragem.
              </Text>
            )}
          </View>

          <View style={styles.card}>
            <InfoRow
              label="Estado"
              value={
                stop.status === 'programada'
                  ? 'Programada'
                  : stop.status === 'em_andamento'
                    ? 'Em andamento'
                    : 'Concluída'
              }
            />
            <InfoRow
              label="Criada por"
              value={
                stop.created_by_type === 'empresa'
                  ? 'Empresa'
                  : 'Motorista'
              }
            />
            <InfoRow
              label="Criada em"
              value={formatDateTime(stop.created_at)}
            />
            <InfoRow
              label="Iniciada em"
              value={formatDateTime(stop.started_at)}
            />
            <InfoRow
              label="Concluída em"
              value={formatDateTime(stop.completed_at)}
            />
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>
                {error}
              </Text>
            </View>
          ) : null}

          {stop.status === 'programada' ? (
            <Pressable
              style={styles.primary}
              disabled={working}
              onPress={() => void start()}>
              {working ? (
                <ActivityIndicator color="#101217" />
              ) : (
                <Text style={styles.primaryText}>
                  Iniciar paragem
                </Text>
              )}
            </Pressable>
          ) : null}

          {stop.status === 'em_andamento' ? (
            <Pressable
              style={styles.complete}
              disabled={working}
              onPress={() => void complete()}>
              {working ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.completeText}>
                  Concluir paragem
                </Text>
              )}
            </Pressable>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FretixColors.black,
  },
  center: {
    flex: 1,
    backgroundColor: FretixColors.black,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  header: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#202A37',
  },
  back: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: FretixColors.white,
    fontSize: 18,
    fontWeight: '900',
  },
  subtitle: {
    color: '#7D8794',
    fontSize: 9,
    marginTop: 2,
  },
  content: {
    padding: 16,
    gap: 12,
    paddingBottom: 30,
  },
  card: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#273444',
    backgroundColor: '#111723',
    padding: 14,
    gap: 8,
  },
  category: {
    color: FretixColors.white,
    fontSize: 15,
    fontWeight: '900',
  },
  location: {
    color: FretixColors.yellow,
    fontSize: 12,
    fontWeight: '800',
  },
  description: {
    color: '#D1D5DB',
    fontSize: 10,
    lineHeight: 15,
  },
  timerCard: {
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#273444',
    backgroundColor: '#0B0F14',
    padding: 15,
  },
  timerLabel: {
    color: '#7D8794',
    fontSize: 9,
    textTransform: 'uppercase',
  },
  timerValue: {
    color: FretixColors.white,
    fontSize: 27,
    fontWeight: '900',
    marginTop: 5,
  },
  hint: {
    color: '#AAB2BE',
    fontSize: 9,
    marginTop: 7,
  },
  warning: {
    color: '#FCA5A5',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 7,
  },
  row: {
    minHeight: 30,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  rowLabel: {
    color: '#7D8794',
    fontSize: 9,
  },
  rowValue: {
    flex: 1,
    color: '#D1D5DB',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'right',
  },
  errorBox: {
    borderRadius: 11,
    padding: 10,
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  errorText: {
    color: '#FCA5A5',
    fontSize: 10,
    textAlign: 'center',
  },
  primary: {
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#101217',
    fontSize: 11,
    fontWeight: '900',
  },
  complete: {
    minHeight: 48,
    borderRadius: 13,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
});
