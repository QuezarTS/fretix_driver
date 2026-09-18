import { useEffect } from 'react';

import { useAppData } from '@/context/AppDataContext';
import { useAuth } from '@/context/AuthContext';
import { useWebSocket } from '@/context/WebSocketContext';

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
  const { getWallet } = useAuth();
  const {
    refreshMyProposals,
    refreshReceivedProposals,
    refreshMarketplace,
    refreshMyLoads,
    ingestRealtimeNotification,
    refreshNotificationUnreadCount,
    loadNotificationUnreadCountIfNeeded,
  } = useAppData();

  useEffect(() => {
    void loadNotificationUnreadCountIfNeeded();

    const unsubProposals = addListenerForTypes([...PROPOSAL_EVENTS], () => {
      void refreshMyProposals();
      void refreshReceivedProposals();
    });

    const unsubLoads = addListenerForTypes([...LOAD_EVENTS], () => {
      void refreshMarketplace();
      void refreshMyLoads();
    });

    const unsubNotifications = addListenerForTypes('notification.created', (event) => {
      const notification = event.notification;
      if (notification && typeof notification === 'object') {
        ingestRealtimeNotification(notification as any);
      } else {
        void refreshNotificationUnreadCount();
      }

      const notificationType = String((notification as any)?.notification_type ?? '');
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
  ]);

  return null;
}
