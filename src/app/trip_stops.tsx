import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomDialog } from '@/components/custom-dialog';
import { BottomTabInset, FretixColors } from '@/constants/theme';
import { useWebSocket } from '@/context/WebSocketContext';
import {
  tripService,
  type TripStop,
  type TripStopType,
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

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}min`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  if (minutes > 0) {
    return `${minutes}min ${secs}s`;
  }
  return `${secs}s`;
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

function statusLabel(status: string) {
  if (status === 'programada') return 'Programada';
  if (status === 'em_andamento') return 'Em andamento';
  if (status === 'concluida') return 'Concluída';
  return status.replace(/_/g, ' ');
}

function statusColor(status: string) {
  if (status === 'programada') return '#3B82F6';
  if (status === 'em_andamento') return '#FFC107';
  if (status === 'concluida') return '#22C55E';
  return '#94A3B8';
}

export default function TripStopsScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    returnTo?: string | string[];
    from?: string | string[];
  }>();

  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const returnTo = Array.isArray(params.returnTo)
    ? params.returnTo[0]
    : params.returnTo;
  const from = Array.isArray(params.from)
    ? params.from[0]
    : params.from;
  const tripId = id ? Number(id) : null;

  const { addListenerForTypes } = useWebSocket();

  const [stops, setStops] = useState<TripStop[]>([]);
  const [categories, setCategories] = useState<TripStopType[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [workingId, setWorkingId] = useState<number | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [locationName, setLocationName] = useState('');
  const [description, setDescription] = useState('');
  const [now, setNow] = useState(Date.now());

  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogProps, setDialogProps] = useState({
    title: '',
    message: '',
    type: 'info' as 'success' | 'error' | 'info',
  });

  useSmartBackHandler({
    returnTo,
    from,
    fallback: '/trips',
  });

  const showDialog = useCallback(
    (
      title: string,
      message: string,
      type: 'success' | 'error' | 'info' = 'info',
    ) => {
      setDialogProps({ title, message, type });
      setDialogVisible(true);
    },
    [],
  );

  const loadData = useCallback(
    async (silent = false) => {
      if (!tripId) return;

      try {
        if (!silent) setLoading(true);

        const [stopRows, categoryRows] =
          await Promise.all([
            tripService.getTripStops(tripId),
            tripService.getTripStopTypes().catch(() => []),
          ]);

        setStops(stopRows);
        setCategories(categoryRows);

        if (!selectedCategory && categoryRows[0]?.value) {
          setSelectedCategory(categoryRows[0].value);
        }
      } catch (error: any) {
        console.error('Failed to load trip stops:', error);
        showDialog(
          'Erro',
          error?.response?.data?.detail ||
            'Não foi possível carregar as paragens.',
          'error',
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [tripId, selectedCategory, showDialog],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

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
          event.trip_id != null &&
          Number(event.trip_id) !== tripId
        ) {
          return;
        }
        void loadData(true);
      },
    );
  }, [tripId, addListenerForTypes, loadData]);

  useEffect(() => {
    if (!tripId) return;

    const interval = setInterval(
      () => void loadData(true),
      60_000,
    );
    return () => clearInterval(interval);
  }, [tripId, loadData]);

  const sortedStops = useMemo(() => {
    return [...stops].sort((a, b) => {
      const aRank =
        a.status === 'em_andamento'
          ? 0
          : a.status === 'programada'
            ? 1
            : 2;
      const bRank =
        b.status === 'em_andamento'
          ? 0
          : b.status === 'programada'
            ? 1
            : 2;

      if (aRank !== bRank) return aRank - bRank;

      return (
        new Date(b.created_at).getTime() -
        new Date(a.created_at).getTime()
      );
    });
  }, [stops]);

  const activeStop = stops.find(
    (stop) => stop.status === 'em_andamento',
  );

  const resetForm = () => {
    setLocationName('');
    setDescription('');
    setSelectedCategory(categories[0]?.value || '');
  };

  const createStop = async () => {
    if (!tripId) return;
    if (!selectedCategory) {
      showDialog(
        'Categoria obrigatória',
        'Seleccione a categoria da paragem.',
      );
      return;
    }
    if (locationName.trim().length < 2) {
      showDialog(
        'Local obrigatório',
        'Informe o local da paragem.',
      );
      return;
    }
    if (description.trim().length < 3) {
      showDialog(
        'Descrição obrigatória',
        'Explique o motivo da paragem.',
      );
      return;
    }

    try {
      setWorkingId(-1);
      await tripService.createTripStop(tripId, {
        category: selectedCategory,
        location_name: locationName.trim(),
        description: description.trim(),
      });

      setModalVisible(false);
      resetForm();
      await loadData(true);

      showDialog(
        'Paragem iniciada',
        'A paragem foi registada e o tempo começou a contar.',
        'success',
      );
    } catch (error: any) {
      showDialog(
        'Erro',
        error?.response?.data?.detail ||
          'Não foi possível registar a paragem.',
        'error',
      );
    } finally {
      setWorkingId(null);
    }
  };

  const startStop = async (stop: TripStop) => {
    if (!tripId) return;

    try {
      setWorkingId(stop.id);
      await tripService.startTripStop(tripId, stop.id);
      await loadData(true);

      showDialog(
        'Paragem iniciada',
        'O tempo de espera começou a contar.',
        'success',
      );
    } catch (error: any) {
      showDialog(
        'Erro',
        error?.response?.data?.detail ||
          'Não foi possível iniciar a paragem.',
        'error',
      );
    } finally {
      setWorkingId(null);
    }
  };

  const completeStop = async (stop: TripStop) => {
    if (!tripId) return;

    try {
      setWorkingId(stop.id);
      const updated = await tripService.completeTripStop(
        tripId,
        stop.id,
      );
      await loadData(true);

      showDialog(
        'Paragem concluída',
        `Tempo total de espera: ${formatDuration(
          updated.elapsed_seconds || 0,
        )}.`,
        'success',
      );
    } catch (error: any) {
      showDialog(
        'Erro',
        error?.response?.data?.detail ||
          'Não foi possível concluir a paragem.',
        'error',
      );
    } finally {
      setWorkingId(null);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    void loadData(true);
  };

  return (
    <View style={styles.container}>
      <SafeAreaView
        style={styles.safeArea}
        edges={['top']}>
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            onPress={() =>
              goBackSmart({
                returnTo,
                from,
                fallback: '/trips',
              })
            }>
            <Ionicons
              name="arrow-back"
              size={21}
              color={FretixColors.white}
            />
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
              Paragens da viagem
            </Text>
            <Text style={styles.subtitle}>
              Viagem #{tripId ?? '—'}
            </Text>
          </View>

          <Pressable
            style={[
              styles.addButton,
              Boolean(activeStop) &&
                styles.addButtonDisabled,
            ]}
            disabled={Boolean(activeStop)}
            onPress={() => setModalVisible(true)}>
            <Ionicons
              name="add"
              size={20}
              color="#101217"
            />
          </Pressable>
        </View>

        <View style={styles.infoCard}>
          <Ionicons
            name="time-outline"
            size={19}
            color={FretixColors.yellow}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoTitle}>
              Controlo de tempo
            </Text>
            <Text style={styles.infoText}>
              O motorista vê apenas o tempo de espera.
              Valores e taxas financeiras são tratados
              pela empresa e pelo cliente.
            </Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loader}>
            <ActivityIndicator
              size="large"
              color={FretixColors.yellow}
            />
          </View>
        ) : (
          <FlatList
            data={sortedStops}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.content}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                colors={[FretixColors.yellow]}
                tintColor={FretixColors.yellow}
              />
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <Ionicons
                  name="pause-circle-outline"
                  size={46}
                  color="#475569"
                />
                <Text style={styles.emptyTitle}>
                  Nenhuma paragem
                </Text>
                <Text style={styles.emptyText}>
                  Quando a empresa programar uma
                  paragem ela aparecerá aqui. Também
                  pode registar uma nova paragem.
                </Text>
              </View>
            }
            renderItem={({ item }) => {
              const elapsed = getLiveElapsed(item, now);
              const remaining = Math.max(
                0,
                GRACE_SECONDS - elapsed,
              );
              const overtime = Math.max(
                0,
                elapsed - GRACE_SECONDS,
              );
              const color = statusColor(item.status);

              return (
                <View style={styles.stopCard}>
                  <View style={styles.stopHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.stopCategory}>
                        {item.category_label ||
                          item.category}
                      </Text>
                      <Text style={styles.stopLocation}>
                        {item.location_name}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.statusPill,
                        {
                          borderColor: color,
                          backgroundColor: `${color}14`,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.statusText,
                          { color },
                        ]}>
                        {statusLabel(item.status)}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.stopDescription}>
                    {item.description}
                  </Text>

                  {item.created_by_type === 'empresa' ? (
                    <View style={styles.companyBadge}>
                      <Ionicons
                        name="business-outline"
                        size={14}
                        color="#93C5FD"
                      />
                      <Text style={styles.companyBadgeText}>
                        Programada pela empresa
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.driverBadge}>
                      <Ionicons
                        name="person-outline"
                        size={14}
                        color="#FCD34D"
                      />
                      <Text style={styles.driverBadgeText}>
                        Registada pelo motorista
                      </Text>
                    </View>
                  )}

                  {item.status !== 'programada' ? (
                    <View style={styles.timerCard}>
                      <Text style={styles.timerLabel}>
                        Tempo de espera
                      </Text>
                      <Text style={styles.timerValue}>
                        {formatDuration(elapsed)}
                      </Text>

                      {elapsed <= GRACE_SECONDS ? (
                        <Text style={styles.timerHint}>
                          Tempo gratuito restante:{' '}
                          {formatDuration(remaining)}
                        </Text>
                      ) : (
                        <>
                          <Text style={styles.overtimeText}>
                            Período gratuito de 24 horas
                            ultrapassado
                          </Text>
                          <Text style={styles.timerHint}>
                            Tempo após 24h:{' '}
                            {formatDuration(overtime)}
                          </Text>
                        </>
                      )}
                    </View>
                  ) : (
                    <View style={styles.scheduledInfo}>
                      <Ionicons
                        name="information-circle-outline"
                        size={16}
                        color="#93C5FD"
                      />
                      <Text style={styles.scheduledText}>
                        O tempo só começa quando clicar em
                        “Iniciar paragem”.
                      </Text>
                    </View>
                  )}

                  <View style={styles.metaRows}>
                    <Text style={styles.metaText}>
                      Criada: {formatDateTime(item.created_at)}
                    </Text>
                    {item.started_at ? (
                      <Text style={styles.metaText}>
                        Iniciada:{' '}
                        {formatDateTime(item.started_at)}
                      </Text>
                    ) : null}
                    {item.completed_at ? (
                      <Text style={styles.metaText}>
                        Concluída:{' '}
                        {formatDateTime(item.completed_at)}
                      </Text>
                    ) : null}
                  </View>

                  {item.status === 'programada' ? (
                    <Pressable
                      style={styles.primaryButton}
                      disabled={
                        workingId === item.id ||
                        Boolean(activeStop)
                      }
                      onPress={() => void startStop(item)}>
                      {workingId === item.id ? (
                        <ActivityIndicator
                          color="#101217"
                        />
                      ) : (
                        <>
                          <Ionicons
                            name="play"
                            size={17}
                            color="#101217"
                          />
                          <Text style={styles.primaryText}>
                            Iniciar paragem
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}

                  {item.status === 'em_andamento' ? (
                    <Pressable
                      style={styles.completeButton}
                      disabled={workingId === item.id}
                      onPress={() =>
                        void completeStop(item)
                      }>
                      {workingId === item.id ? (
                        <ActivityIndicator
                          color="#FFFFFF"
                        />
                      ) : (
                        <>
                          <Ionicons
                            name="checkmark-circle-outline"
                            size={18}
                            color="#FFFFFF"
                          />
                          <Text style={styles.completeText}>
                            Concluir paragem
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ) : null}
                </View>
              );
            }}
          />
        )}

        <Modal
          visible={modalVisible}
          transparent
          animationType="slide"
          onRequestClose={() =>
            setModalVisible(false)
          }>
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalTitle}>
                    Registar paragem
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    O cronómetro começa imediatamente.
                  </Text>
                </View>
                <Pressable
                  onPress={() =>
                    setModalVisible(false)
                  }>
                  <Ionicons
                    name="close"
                    size={22}
                    color={FretixColors.white}
                  />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={
                  styles.formContent
                }>
                <Text style={styles.fieldLabel}>
                  Categoria
                </Text>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.chips}>
                  {categories.map((category) => {
                    const active =
                      selectedCategory ===
                      category.value;

                    return (
                      <Pressable
                        key={category.value}
                        style={[
                          styles.chip,
                          active &&
                            styles.chipActive,
                        ]}
                        onPress={() =>
                          setSelectedCategory(
                            category.value,
                          )
                        }>
                        <Text
                          style={[
                            styles.chipText,
                            active &&
                              styles.chipTextActive,
                          ]}>
                          {category.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>

                <Text style={styles.fieldLabel}>
                  Local
                </Text>
                <TextInput
                  value={locationName}
                  onChangeText={setLocationName}
                  placeholder="Ex.: Ressano Garcia"
                  placeholderTextColor="#64748B"
                  style={styles.input}
                />

                <Text style={styles.fieldLabel}>
                  Motivo / descrição
                </Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Ex.: Regularização da carga"
                  placeholderTextColor="#64748B"
                  multiline
                  style={[
                    styles.input,
                    styles.textArea,
                  ]}
                />
              </ScrollView>

              <View style={styles.modalFooter}>
                <Pressable
                  style={styles.cancelButton}
                  onPress={() =>
                    setModalVisible(false)
                  }>
                  <Text style={styles.cancelText}>
                    Cancelar
                  </Text>
                </Pressable>

                <Pressable
                  style={styles.saveButton}
                  disabled={workingId === -1}
                  onPress={() => void createStop()}>
                  {workingId === -1 ? (
                    <ActivityIndicator
                      color="#101217"
                    />
                  ) : (
                    <Text style={styles.saveText}>
                      Registar e iniciar
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <CustomDialog
          visible={dialogVisible}
          title={dialogProps.title}
          message={dialogProps.message}
          type={dialogProps.type}
          onConfirm={() =>
            setDialogVisible(false)
          }
          onCancel={() =>
            setDialogVisible(false)
          }
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FretixColors.black,
  },
  safeArea: { flex: 1 },
  header: {
    minHeight: 66,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#202A37',
  },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: FretixColors.white,
    fontSize: 19,
    fontWeight: '900',
  },
  subtitle: {
    color: '#7D8794',
    fontSize: 10,
    marginTop: 2,
  },
  addButton: {
    width: 39,
    height: 39,
    borderRadius: 12,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonDisabled: { opacity: 0.35 },
  infoCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.18)',
    backgroundColor: 'rgba(255,193,7,0.05)',
    flexDirection: 'row',
    gap: 9,
  },
  infoTitle: {
    color: FretixColors.white,
    fontSize: 10,
    fontWeight: '800',
  },
  infoText: {
    color: '#AAB2BE',
    fontSize: 9,
    lineHeight: 14,
    marginTop: 2,
  },
  loader: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    paddingBottom: BottomTabInset + 30,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 80,
    gap: 8,
  },
  emptyTitle: {
    color: FretixColors.white,
    fontSize: 16,
    fontWeight: '800',
  },
  emptyText: {
    color: '#7D8794',
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
    maxWidth: 280,
  },
  stopCard: {
    backgroundColor: '#111824',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#273241',
    padding: 14,
    gap: 10,
    marginBottom: 12,
  },
  stopHeader: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  stopCategory: {
    color: FretixColors.white,
    fontSize: 13,
    fontWeight: '900',
  },
  stopLocation: {
    color: '#AAB2BE',
    fontSize: 10,
    marginTop: 3,
  },
  statusPill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusText: {
    fontSize: 8,
    fontWeight: '900',
  },
  stopDescription: {
    color: '#D1D5DB',
    fontSize: 10,
    lineHeight: 15,
  },
  companyBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(59,130,246,0.10)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  companyBadgeText: {
    color: '#93C5FD',
    fontSize: 8,
    fontWeight: '700',
  },
  driverBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,193,7,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  driverBadgeText: {
    color: '#FCD34D',
    fontSize: 8,
    fontWeight: '700',
  },
  timerCard: {
    borderRadius: 13,
    backgroundColor: '#0B0F14',
    padding: 12,
    borderWidth: 1,
    borderColor: '#263242',
  },
  timerLabel: {
    color: '#7D8794',
    fontSize: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timerValue: {
    color: FretixColors.white,
    fontSize: 24,
    fontWeight: '900',
    marginTop: 3,
  },
  timerHint: {
    color: '#AAB2BE',
    fontSize: 9,
    marginTop: 5,
  },
  overtimeText: {
    color: '#FCA5A5',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 5,
  },
  scheduledInfo: {
    borderRadius: 11,
    backgroundColor: 'rgba(59,130,246,0.08)',
    padding: 10,
    flexDirection: 'row',
    gap: 7,
  },
  scheduledText: {
    flex: 1,
    color: '#BFDBFE',
    fontSize: 9,
    lineHeight: 14,
  },
  metaRows: { gap: 3 },
  metaText: {
    color: '#64748B',
    fontSize: 8,
  },
  primaryButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: FretixColors.yellow,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  primaryText: {
    color: '#101217',
    fontSize: 11,
    fontWeight: '900',
  },
  completeButton: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  completeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '900',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.76)',
  },
  modalCard: {
    maxHeight: '82%',
    backgroundColor: '#111824',
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2B3746',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    alignItems: 'flex-start',
  },
  modalTitle: {
    color: FretixColors.white,
    fontSize: 18,
    fontWeight: '900',
  },
  modalSubtitle: {
    color: '#7D8794',
    fontSize: 9,
    marginTop: 3,
  },
  formContent: {
    paddingVertical: 15,
    gap: 9,
  },
  fieldLabel: {
    color: '#AAB2BE',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 3,
  },
  chips: { gap: 7 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: FretixColors.yellow,
    borderColor: FretixColors.yellow,
  },
  chipText: {
    color: '#AAB2BE',
    fontSize: 9,
    fontWeight: '700',
  },
  chipTextActive: {
    color: '#101217',
  },
  input: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#313D4D',
    backgroundColor: '#0B0F14',
    color: FretixColors.white,
    paddingHorizontal: 12,
    fontSize: 11,
  },
  textArea: {
    minHeight: 92,
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  modalFooter: {
    flexDirection: 'row',
    gap: 9,
  },
  cancelButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    color: FretixColors.white,
    fontSize: 10,
    fontWeight: '800',
  },
  saveButton: {
    flex: 1.5,
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: {
    color: '#101217',
    fontSize: 10,
    fontWeight: '900',
  },
});
