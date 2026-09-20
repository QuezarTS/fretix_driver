import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CustomDialog } from '@/components/custom-dialog';
import { FretixColors } from '@/constants/theme';
import { useWebSocket } from '@/context/WebSocketContext';
import {
  tripEvidenceService,
  type EvidenceStage,
  type EvidenceType,
  type TripEvidence,
  type TripEvidenceSummary,
} from '@/services/trip-evidence';
import { getApiErrorMessage } from '@/utils/api-error';
import { tripService } from '@/services/trips';
import { resolveMediaUrl } from '@/utils/media-url';
import { goBackSmart, useSmartBackHandler } from '@/utils/navigation';

export default function TripEvidenceScreen() {
  const params = useLocalSearchParams<{
    id?: string | string[];
    stage?: string | string[];
    returnTo?: string | string[];
    from?: string | string[];
  }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const rawStage = Array.isArray(params.stage) ? params.stage[0] : params.stage;
  const stage: EvidenceStage = rawStage === 'delivery' ? 'delivery' : 'pickup';
  const returnTo = Array.isArray(params.returnTo) ? params.returnTo[0] : params.returnTo;
  const from = Array.isArray(params.from) ? params.from[0] : params.from;
  const tripId = id ? Number(id) : null;
  const { addListenerForTypes } = useWebSocket();

  const [summary, setSummary] = useState<TripEvidenceSummary | null>(null);
  const [evidence, setEvidence] = useState<TripEvidence[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnAfterSuccess, setReturnAfterSuccess] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [dialog, setDialog] = useState({ title: '', message: '', type: 'info' as 'info' | 'success' | 'error' });

  useSmartBackHandler({ returnTo, from, fallback: '/trips' });

  const showDialog = useCallback((title: string, message: string, type: 'info' | 'success' | 'error' = 'info') => {
    setDialog({ title, message, type });
    setDialogVisible(true);
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!tripId) return;
    try {
      if (!silent) setLoading(true);
      const [summaryData, evidenceData] = await Promise.all([
        tripEvidenceService.summary(tripId),
        tripEvidenceService.list(tripId),
      ]);
      setSummary(summaryData);
      setEvidence(evidenceData);
    } catch (error) {
      showDialog('Erro', getApiErrorMessage(error, 'Não foi possível carregar as provas da viagem.'), 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tripId, showDialog]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!tripId) return;
    return addListenerForTypes(
      ['trip.evidence_uploaded', 'trip.pickup_evidence_finalized', 'trip.delivery_evidence_finalized'],
      (event) => {
        if (event.trip_id == null || Number(event.trip_id) === tripId) void load(true);
      },
    );
  }, [tripId, addListenerForTypes, load]);

  const stageSummary = summary?.[stage];
  const photoType: EvidenceType = stage === 'pickup' ? 'pickup_photo' : 'delivery_photo';
  const photos = useMemo(() => evidence.filter((item) => item.evidence_type === photoType), [evidence, photoType]);
  const pod = evidence.find((item) => item.evidence_type === 'proof_of_delivery');
  const finalized = Boolean(stageSummary?.finalized);

  const takePhoto = async (type: EvidenceType) => {
    if (!tripId || busy || finalized) return;
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showDialog('Permissão necessária', 'Autorize o acesso à câmara para registar a prova.', 'error');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    try {
      setBusy(true);
      await tripEvidenceService.upload(tripId, type, result.assets[0]);
      await load(true);
    } catch (error) {
      showDialog('Falha no envio', getApiErrorMessage(error, 'Não foi possível enviar a fotografia.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeEvidence = async (item: TripEvidence) => {
    if (!tripId || busy || finalized) return;
    try {
      setBusy(true);
      await tripEvidenceService.remove(tripId, item.id);
      await load(true);
    } catch (error) {
      showDialog('Erro', getApiErrorMessage(error, 'Não foi possível remover a prova.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const finalize = async () => {
    if (!tripId || busy || finalized || !stageSummary?.ready_to_finalize) return;
    try {
      setBusy(true);
      const data = await tripEvidenceService.finalize(tripId, stage);
      setSummary(data);
      if (stage === 'delivery') {
        await tripService.endTrip(tripId);
      }
      setReturnAfterSuccess(true);
      showDialog(
        stage === 'pickup' ? 'Recolha comprovada' : 'Entrega registada',
        stage === 'pickup'
          ? 'As fotografias foram guardadas com sucesso. Pode continuar com o carregamento.'
          : 'As provas foram guardadas. A entrega está concluída e aguarda apenas a confirmação do cliente.',
        'success',
      );
    } catch (error) {
      showDialog('Erro', getApiErrorMessage(error, 'Não foi possível finalizar as provas.'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const closeDialog = () => {
    setDialogVisible(false);
    if (!returnAfterSuccess || !tripId) return;
    setReturnAfterSuccess(false);
    router.replace({
      pathname: '/trip_details',
      params: { id: String(tripId), returnTo: '/trips' },
    });
  };

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={FretixColors.yellow} /></View>;
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Pressable onPress={() => goBackSmart({ returnTo, from, fallback: '/trips' })} style={styles.iconButton}>
            <Ionicons name="arrow-back" size={22} color={FretixColors.white} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>Viagem #{id}</Text>
            <Text style={styles.title}>{stage === 'pickup' ? 'Provas da recolha' : 'Provas da entrega'}</Text>
          </View>
          {finalized ? <Ionicons name="checkmark-circle" size={28} color="#22C55E" /> : null}
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor={FretixColors.yellow} />}
        >
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>{finalized ? 'Etapa finalizada' : 'Fotografe a carga'}</Text>
            <Text style={styles.infoText}>
              Envie entre {stageSummary?.min_photos ?? 3} e {stageSummary?.max_photos ?? 5} fotografias nítidas.
              {stage === 'delivery' ? ' Inclua também uma fotografia do comprovativo de entrega assinado.' : ''}
            </Text>
          </View>

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Fotografias da carga</Text>
            <Text style={styles.counter}>{photos.length}/{stageSummary?.max_photos ?? 5}</Text>
          </View>
          <View style={styles.grid}>
            {photos.map((item) => (
              <View key={item.id} style={styles.photoWrap}>
                <Image source={{ uri: resolveMediaUrl(item.file_url) ?? undefined }} style={styles.photo} />
                {!finalized ? (
                  <Pressable style={styles.removeButton} onPress={() => void removeEvidence(item)} disabled={busy}>
                    <Ionicons name="trash" size={16} color="#fff" />
                  </Pressable>
                ) : null}
              </View>
            ))}
            {!finalized && photos.length < (stageSummary?.max_photos ?? 5) ? (
              <Pressable style={styles.addPhoto} onPress={() => void takePhoto(photoType)} disabled={busy}>
                <Ionicons name="camera" size={28} color={FretixColors.yellow} />
                <Text style={styles.addText}>Fotografar</Text>
              </Pressable>
            ) : null}
          </View>

          {stage === 'delivery' ? (
            <View style={styles.podCard}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>Comprovativo de entrega</Text>
                <Text style={styles.infoText}>{pod ? 'Comprovativo anexado.' : 'Fotografe o documento assinado pelo cliente.'}</Text>
              </View>
              {pod ? (
                <View style={styles.podReady}>
                  <Ionicons name="document-text" size={24} color="#22C55E" />
                  {!finalized ? <Pressable onPress={() => void removeEvidence(pod)}><Ionicons name="trash" size={18} color="#EF4444" /></Pressable> : null}
                </View>
              ) : (
                <Pressable style={styles.cameraButton} onPress={() => void takePhoto('proof_of_delivery')} disabled={busy || finalized}>
                  <Ionicons name="camera" size={20} color="#101217" />
                </Pressable>
              )}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={[styles.finalizeButton, (!stageSummary?.ready_to_finalize || finalized || busy) && styles.disabled]}
            onPress={() => void finalize()}
            disabled={!stageSummary?.ready_to_finalize || finalized || busy}
          >
            {busy ? <ActivityIndicator color="#101217" /> : <Text style={styles.finalizeText}>{finalized ? 'Provas finalizadas' : 'Finalizar provas'}</Text>}
          </Pressable>
        </View>

        <CustomDialog visible={dialogVisible} title={dialog.title} message={dialog.message} type={dialog.type} confirmText="Continuar" onConfirm={closeDialog} onCancel={closeDialog} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: FretixColors.black },
  loader: { flex: 1, backgroundColor: FretixColors.black, alignItems: 'center', justifyContent: 'center' },
  header: { minHeight: 72, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderBottomColor: '#1F2937' },
  iconButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { color: '#94A3B8', fontSize: 11, textTransform: 'uppercase' },
  title: { color: FretixColors.white, fontSize: 20, fontWeight: '800' },
  content: { padding: 16, paddingBottom: 120, gap: 18 },
  infoCard: { backgroundColor: '#111824', borderRadius: 18, borderWidth: 1, borderColor: '#273241', padding: 16, gap: 8 },
  infoTitle: { color: FretixColors.white, fontSize: 16, fontWeight: '800' },
  infoText: { color: '#CBD5E1', fontSize: 13, lineHeight: 19 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: FretixColors.white, fontSize: 15, fontWeight: '800' },
  counter: { color: FretixColors.yellow, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoWrap: { width: '31%', aspectRatio: 1, borderRadius: 14, overflow: 'hidden', backgroundColor: '#111824' },
  photo: { width: '100%', height: '100%' },
  removeButton: { position: 'absolute', right: 6, top: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(239,68,68,.9)', alignItems: 'center', justifyContent: 'center' },
  addPhoto: { width: '31%', aspectRatio: 1, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: FretixColors.yellow, alignItems: 'center', justifyContent: 'center', gap: 6 },
  addText: { color: FretixColors.yellow, fontSize: 12, fontWeight: '700' },
  podCard: { backgroundColor: '#111824', borderRadius: 18, borderWidth: 1, borderColor: '#273241', padding: 16, flexDirection: 'row', gap: 12, alignItems: 'center' },
  podReady: { alignItems: 'center', gap: 12 },
  cameraButton: { width: 48, height: 48, borderRadius: 14, backgroundColor: FretixColors.yellow, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: '#0B0F14', borderTopWidth: 1, borderTopColor: '#1F2937' },
  finalizeButton: { minHeight: 54, borderRadius: 16, backgroundColor: FretixColors.yellow, alignItems: 'center', justifyContent: 'center' },
  disabled: { backgroundColor: '#4B5563' },
  finalizeText: { color: '#101217', fontSize: 16, fontWeight: '800' },
});
