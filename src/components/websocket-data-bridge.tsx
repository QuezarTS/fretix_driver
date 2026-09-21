import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { FretixColors } from '@/constants/theme';
import { useAppData } from '@/context/AppDataContext';
import { useAuth } from '@/context/AuthContext';
import { useWebSocket } from '@/context/WebSocketContext';
import { notificationService, type AppNotification } from '@/services/notifications';
import { tripService, type Trip } from '@/services/trips';

const PROPOSAL_EVENTS = [
  'proposal.created',
  'proposal.accepted',
  'proposal.rejected',
  'proposal.accepted_ack',
  'proposal.rejected_ack',
  'negotiation.created',
  'negotiation.accepted',
  'negotiation.rejected',
  'negotiation.sent',
  'negotiation.accepted_ack',
  'negotiation.rejected_ack',
] as const;

const LOAD_EVENTS = ['trip.status_changed', 'trip.location', 'trip.assigned'] as const;

/** Liga eventos WebSocket globais às listas em cache do AppDataContext. */
export function WebSocketDataBridge() {
  const { addListenerForTypes } = useWebSocket();
  const { getWallet, isDriver } = useAuth();
  const [assignedTrip, setAssignedTrip] = useState<Trip | null>(null);
  const [assignedMessage, setAssignedMessage] = useState('');
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [assignmentVisible, setAssignmentVisible] = useState(false);
  const notificationIdRef = useRef<number | null>(null);
  const handledTripIdsRef = useRef(new Set<number>());
  const {
    refreshMyProposals,
    refreshReceivedProposals,
    refreshMarketplace,
    refreshMyLoads,
    ingestRealtimeNotification,
    refreshNotificationUnreadCount,
    loadNotificationUnreadCountIfNeeded,
  } = useAppData();

  const showAssignedTrip = useCallback(async (
    tripId: number,
    notification?: AppNotification,
  ) => {
    if (!isDriver || handledTripIdsRef.current.has(tripId)) return;

    handledTripIdsRef.current.add(tripId);
    notificationIdRef.current = notification?.id ?? null;
    setAssignedMessage(
      notification?.body || 'Foi-lhe atribuída uma nova carga. Consulte os detalhes para iniciar a recolha.',
    );
    setAssignedTrip(null);
    setAssignmentVisible(true);
    setAssignmentLoading(true);

    try {
      setAssignedTrip(await tripService.getTrip(tripId));
    } catch {
      // O modal continua útil com a mensagem da notificação e o ID da viagem.
      setAssignedTrip({ id: tripId } as Trip);
    } finally {
      setAssignmentLoading(false);
    }
  }, [isDriver]);

  const closeAssignment = useCallback(() => {
    const notificationId = notificationIdRef.current;
    setAssignmentVisible(false);
    if (notificationId != null) {
      void notificationService.markAsRead(notificationId).catch(() => {});
    }
    notificationIdRef.current = null;
  }, []);

  const openAssignedTrip = useCallback(() => {
    const tripId = assignedTrip?.id;
    closeAssignment();
    if (tripId != null) {
      router.push({ pathname: '/trip_details', params: { id: String(tripId) } });
    }
  }, [assignedTrip?.id, closeAssignment]);

  useEffect(() => {
    void loadNotificationUnreadCountIfNeeded();

    const unsubProposals = addListenerForTypes([...PROPOSAL_EVENTS], () => {
      void refreshMyProposals();
      void refreshReceivedProposals();
    });

    const unsubLoads = addListenerForTypes([...LOAD_EVENTS], (event) => {
      void refreshMarketplace();
      void refreshMyLoads();

      if (event.type === 'trip.assigned' && typeof event.trip_id === 'number') {
        const tripId = event.trip_id;
        void notificationService.getNotifications(true).then((notifications) => {
          const assignment = notifications.find(
            (item) =>
              item.notification_type === 'trip.assigned' &&
              item.payload?.trip_id === tripId,
          );
          void showAssignedTrip(tripId, assignment);
        }).catch(() => {
          void showAssignedTrip(tripId);
        });
      }
    });

    const unsubNotifications = addListenerForTypes('notification.created', (event) => {
      const notification = event.notification;
      if (notification && typeof notification === 'object') {
        ingestRealtimeNotification(notification as any);
      } else {
        void refreshNotificationUnreadCount();
      }

      const notificationType = String((notification as any)?.notification_type ?? '');
      if (
        notificationType === 'trip.assigned' &&
        typeof (notification as any)?.payload?.trip_id === 'number'
      ) {
        void showAssignedTrip(
          (notification as any).payload.trip_id,
          notification as AppNotification,
        );
      }
      if (notificationType.includes('deposit') || notificationType.includes('wallet')) {
        void getWallet();
      }
    });

    return () => {
      unsubProposals();
      unsubLoads();
      unsubNotifications();
    };
  }, [
    addListenerForTypes,
    refreshMyProposals,
    refreshReceivedProposals,
    refreshMarketplace,
    refreshMyLoads,
    ingestRealtimeNotification,
    refreshNotificationUnreadCount,
    loadNotificationUnreadCountIfNeeded,
    getWallet,
    showAssignedTrip,
  ]);

  useEffect(() => {
    if (!isDriver) return;

    let active = true;
    void notificationService.getNotifications(true).then((notifications) => {
      if (!active) return;
      const assignment = notifications.find(
        (item) =>
          item.notification_type === 'trip.assigned' &&
          typeof item.payload?.trip_id === 'number',
      );
      if (assignment) {
        void showAssignedTrip(assignment.payload.trip_id, assignment);
      }
    }).catch(() => {});

    return () => {
      active = false;
    };
  }, [isDriver, showAssignedTrip]);

  const load = assignedTrip?.load;
  const origin = load?.origin || assignedTrip?.origin;
  const destination = load?.destination || assignedTrip?.destination;
  const code = load?.code || assignedTrip?.load_code;

  return (
    <Modal
      visible={assignmentVisible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={closeAssignment}>
      <View style={styles.overlay}>
        <View style={styles.card} accessibilityRole="alert">
          <Pressable style={styles.closeButton} onPress={closeAssignment} hitSlop={10}>
            <Ionicons name="close" size={22} color="#AAB2BE" />
          </Pressable>

          <View style={styles.iconWrap}>
            <Ionicons name="cube" size={32} color="#101217" />
          </View>
          <Text style={styles.eyebrow}>NOVA ATRIBUIÇÃO</Text>
          <Text style={styles.title}>Foi-lhe atribuída uma carga</Text>
          <Text style={styles.message}>{assignedMessage}</Text>

          {assignmentLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={FretixColors.yellow} />
              <Text style={styles.loadingText}>A carregar detalhes...</Text>
            </View>
          ) : assignedTrip ? (
            <View style={styles.detailsCard}>
              {code ? (
                <View style={styles.codeRow}>
                  <Text style={styles.detailLabel}>Carga</Text>
                  <Text style={styles.codeText}>#{code}</Text>
                </View>
              ) : null}
              {origin ? (
                <View style={styles.routeRow}>
                  <Ionicons name="location" size={18} color="#60A5FA" />
                  <View style={styles.routeTextWrap}>
                    <Text style={styles.detailLabel}>Recolher em</Text>
                    <Text style={styles.detailValue} numberOfLines={2}>{origin}</Text>
                  </View>
                </View>
              ) : null}
              {destination ? (
                <View style={styles.routeRow}>
                  <Ionicons name="flag" size={18} color={FretixColors.yellow} />
                  <View style={styles.routeTextWrap}>
                    <Text style={styles.detailLabel}>Entregar em</Text>
                    <Text style={styles.detailValue} numberOfLines={2}>{destination}</Text>
                  </View>
                </View>
              ) : null}
              {assignedTrip.vehicle?.plate ? (
                <View style={styles.vehicleRow}>
                  <Ionicons name="car-sport-outline" size={18} color="#86EFAC" />
                  <Text style={styles.vehicleText}>Camião {assignedTrip.vehicle.plate}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <Pressable
            style={[styles.primaryButton, assignmentLoading && styles.primaryButtonDisabled]}
            disabled={assignmentLoading || assignedTrip == null}
            onPress={openAssignedTrip}>
            <Text style={styles.primaryButtonText}>Ver carga</Text>
            <Ionicons name="arrow-forward" size={19} color="#101217" />
          </Pressable>
          <Text style={styles.hint}>Abra a carga para iniciar o percurso até ao carregamento.</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 22,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  card: {
    width: '100%',
    maxWidth: 390,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2A3544',
    backgroundColor: '#101722',
    padding: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.45,
    shadowRadius: 22,
    elevation: 18,
  },
  closeButton: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#192230',
    zIndex: 2,
  },
  iconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: FretixColors.yellow,
    marginBottom: 16,
  },
  eyebrow: { color: FretixColors.yellow, fontSize: 11, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: FretixColors.white, fontSize: 23, lineHeight: 29, fontWeight: '900', marginTop: 5, paddingRight: 28 },
  message: { color: '#AAB4C2', fontSize: 14, lineHeight: 21, marginTop: 9 },
  loadingRow: { minHeight: 92, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  loadingText: { color: '#AAB4C2', fontSize: 13, fontWeight: '700' },
  detailsCard: { marginTop: 18, padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#293646', backgroundColor: '#0B111A', gap: 13 },
  codeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  codeText: { color: FretixColors.yellow, fontSize: 14, fontWeight: '900' },
  routeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  routeTextWrap: { flex: 1 },
  detailLabel: { color: '#7F8A99', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.7 },
  detailValue: { color: FretixColors.white, fontSize: 14, lineHeight: 19, fontWeight: '700', marginTop: 2 },
  vehicleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 },
  vehicleText: { color: '#C9D2DD', fontSize: 13, fontWeight: '700' },
  primaryButton: { minHeight: 52, marginTop: 20, borderRadius: 14, backgroundColor: FretixColors.yellow, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  primaryButtonDisabled: { opacity: 0.55 },
  primaryButtonText: { color: '#101217', fontSize: 16, fontWeight: '900' },
  hint: { color: '#758090', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 10 },
});
