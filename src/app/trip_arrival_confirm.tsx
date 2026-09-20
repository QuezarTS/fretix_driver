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

import { CustomDialog } from '@/components/custom-dialog';
import { BottomTabInset, FretixColors } from '@/constants/theme';
import { useTripRealtime } from '@/hooks/useTripRealtime';
import { tripEvidenceService, type TripEvidenceSummary } from '@/services/trip-evidence';
import { tripService, type Trip } from '@/services/trips';
import { getApiErrorMessage } from '@/utils/api-error';
import { buildReturnTo, goBackSmart, pushWithReturnTo, useSmartBackHandler } from '@/utils/navigation';

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function TripArrivalConfirmScreen() {
  const params = useLocalSearchParams<{ id?: string; returnTo?: string | string[]; from?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [evidenceSummary, setEvidenceSummary] = useState<TripEvidenceSummary | null>(null);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialogProps, setDialogProps] = useState({
    title: '',
    message: '',
    type: 'info' as 'success' | 'error' | 'info',
  });

  useSmartBackHandler({ returnTo, from, fallback: '/trips' });

  const numericTripId = id ? Number.parseInt(id, 10) : null;
  const { liveTrip, liveStatus, applyTripSnapshot } = useTripRealtime(
    Number.isFinite(numericTripId) ? numericTripId : null,
    { initialTrip: trip },
  );

  const showDialog = useCallback((title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setDialogProps({ title, message, type });
    setDialogVisible(true);
  }, []);

  const loadTrip = useCallback(async () => {
    if (!id) return;

    try {
      setLoading(true);
      const [data, evidenceData] = await Promise.all([
        tripService.getTrip(id),
        tripEvidenceService.summary(id).catch(() => null),
      ]);
      setTrip(data);
      setEvidenceSummary(evidenceData);
      applyTripSnapshot(data);
    } catch (error) {
      console.error('Failed to load trip for arrival confirmation:', error);
      showDialog('Erro', 'Não foi possível carregar os dados da viagem.', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, showDialog]);

  useEffect(() => {
    void loadTrip();
  }, [loadTrip]);

  const handleConfirmArrival = async () => {
    if (!id) return;
    if (!evidenceSummary?.delivery.finalized) {
      pushWithReturnTo(
        '/trip_evidence',
        { id, stage: 'delivery' },
        buildReturnTo('/trip_arrival_confirm', { id, returnTo }),
      );
      return;
    }

    try {
      setConfirming(true);
      const updatedTrip = await tripService.endTrip(id);
      setTrip(updatedTrip);
      applyTripSnapshot(updatedTrip);
      showDialog('Entrega registada', 'A entrega foi concluída. Aguarde apenas a confirmação do cliente.', 'success');
    } catch (error) {
      console.error('Failed to confirm trip arrival:', error);
      showDialog('Erro', getApiErrorMessage(error, 'Não foi possível confirmar a chegada.'), 'error');
    } finally {
      setConfirming(false);
    }
  };

  const handleDialogClose = () => {
    const success = dialogProps.type === 'success';
    setDialogVisible(false);

    if (success && trip?.id) {
      goBackSmart({ returnTo, from, fallback: '/trips' });
    }
  };

  const activeTrip = liveTrip ?? trip;
  const currentStatus = liveStatus ?? activeTrip?.status ?? null;
  const canConfirmArrival = currentStatus === 'viagem_iniciada';
  const deliveryEvidenceReady = Boolean(evidenceSummary?.delivery.finalized);

  if (loading) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={FretixColors.yellow} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!activeTrip) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Viagem não encontrada</Text>
            <Pressable style={styles.secondaryButton} onPress={() => goBackSmart({ returnTo, from, fallback: '/trips' })}>
              <Text style={styles.secondaryButtonText}>Voltar</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <Pressable style={styles.iconButton} onPress={() => goBackSmart({ returnTo, from, fallback: '/trips' })}>
              <Ionicons name="arrow-back" size={20} color={FretixColors.white} />
            </Pressable>
            <View style={styles.headerTextWrap}>
              <Text style={styles.headerEyebrow}>Finalização</Text>
              <Text style={styles.headerTitle}>Confirmar chegada</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.heroCard}>
            <View style={styles.heroIconWrap}>
              <Ionicons name="flag" size={26} color="#101217" />
            </View>
            <Text style={styles.heroTitle}>Você chegou ao destino?</Text>
            <Text style={styles.heroSubtitle}>
              Confirme que a carga foi entregue no local indicado. Depois disso, o cliente poderá validar o recebimento.
            </Text>
          </View>

          <View style={styles.summaryCard}>
            <Text style={styles.sectionTitle}>Resumo da viagem</Text>

            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Viagem</Text>
              <Text style={styles.infoValue}>#{activeTrip.id}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Carga</Text>
              <Text style={styles.infoValue}>{activeTrip.load_code || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Origem</Text>
              <Text style={styles.infoValue}>{activeTrip.origin}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Destino</Text>
              <Text style={styles.infoValue}>{activeTrip.destination}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Cliente</Text>
              <Text style={styles.infoValue}>{activeTrip.client_name || '—'}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Iniciada em</Text>
              <Text style={styles.infoValue}>{formatDateTime(activeTrip.started_at)}</Text>
            </View>
          </View>

          <View style={styles.warningCard}>
            <Ionicons name="information-circle-outline" size={20} color={FretixColors.yellow} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>Antes de confirmar</Text>
              <Text style={styles.warningText}>Confirme apenas quando o camião e a carga estiverem no destino final.</Text>
            </View>
          </View>

          <Pressable
            style={[styles.evidenceCard, deliveryEvidenceReady && styles.evidenceCardReady]}
            onPress={() => id && pushWithReturnTo(
              '/trip_evidence',
              { id, stage: 'delivery' },
              buildReturnTo('/trip_arrival_confirm', { id, returnTo }),
            )}
          >
            <Ionicons name={deliveryEvidenceReady ? 'checkmark-circle' : 'camera'} size={24} color={deliveryEvidenceReady ? '#22C55E' : FretixColors.yellow} />
            <View style={{ flex: 1 }}>
              <Text style={styles.warningTitle}>Provas da entrega</Text>
              <Text style={styles.warningText}>
                {deliveryEvidenceReady
                  ? 'Fotografias e comprovativo finalizados.'
                  : `${evidenceSummary?.delivery.photo_count ?? 0}/3 fotografias · comprovativo ${evidenceSummary?.delivery.proof_of_delivery_count ? 'anexado' : 'em falta'}`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
          </Pressable>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => goBackSmart({ returnTo, from, fallback: '/trips' })}
          >
            <Text style={styles.secondaryButtonText}>Voltar aos detalhes</Text>
          </Pressable>

          <Pressable
            style={[styles.primaryButton, (!canConfirmArrival || !deliveryEvidenceReady) && styles.primaryButtonDisabled]}
            onPress={handleConfirmArrival}
            disabled={!canConfirmArrival || !deliveryEvidenceReady || confirming}
          >
            {confirming ? (
              <ActivityIndicator size="small" color="#101217" />
            ) : (
              <Text style={styles.primaryButtonText}>
                {!canConfirmArrival
                  ? 'Chegada indisponível'
                  : deliveryEvidenceReady
                    ? 'Confirmar chegada'
                    : 'Finalize as provas da entrega'}
              </Text>
            )}
          </Pressable>
        </View>

        <CustomDialog
          visible={dialogVisible}
          title={dialogProps.title}
          message={dialogProps.message}
          type={dialogProps.type}
          onConfirm={handleDialogClose}
          onCancel={handleDialogClose}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FretixColors.black },
  safeArea: { flex: 1 },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, paddingBottom: BottomTabInset + 140, gap: 16 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  iconButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: { flex: 1, gap: 2 },
  headerEyebrow: { color: FretixColors.grayLight, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  headerTitle: { color: FretixColors.white, fontSize: 20, fontWeight: '800' },
  headerSpacer: { width: 42 },
  heroCard: {
    backgroundColor: '#101720',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2A3646',
    padding: 20,
    alignItems: 'center',
    gap: 12,
  },
  heroIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { color: FretixColors.white, fontSize: 22, fontWeight: '800', textAlign: 'center' },
  heroSubtitle: { color: '#CBD5E1', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  highlight: { color: FretixColors.yellow, fontWeight: '800' },
  summaryCard: {
    backgroundColor: '#111824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#273241',
    padding: 16,
    gap: 14,
  },
  sectionTitle: { color: FretixColors.white, fontSize: 16, fontWeight: '800' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  infoLabel: { color: '#94A3B8', fontSize: 13 },
  infoValue: { color: FretixColors.white, fontSize: 13, fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  warningCard: {
    backgroundColor: '#111824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#273241',
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  warningTitle: { color: FretixColors.white, fontSize: 14, fontWeight: '800' },
  warningText: { color: '#CBD5E1', fontSize: 13, lineHeight: 19, marginTop: 4 },
  evidenceCard: {
    backgroundColor: '#111824',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: FretixColors.yellow,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
  },
  evidenceCardReady: { borderColor: '#22C55E' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: BottomTabInset,
    backgroundColor: '#0B0F14',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
    gap: 10,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonDisabled: {
    backgroundColor: '#495566',
  },
  primaryButtonText: { color: '#101217', fontSize: 16, fontWeight: '800' },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: '#111824',
    borderWidth: 1,
    borderColor: '#273241',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  secondaryButtonText: { color: FretixColors.white, fontSize: 15, fontWeight: '700' },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  emptyTitle: { color: FretixColors.white, fontSize: 18, fontWeight: '800' },
});
