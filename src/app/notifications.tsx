import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { FlowScreenHeader } from '@/components/wallet/flow-screen-header';
import { SkeletonNotificationList } from '@/components/SkeletonLoader';
import { FretixColors } from '@/constants/theme';
import { AppNotification, notificationService } from '@/services/notifications';
import { useAppData } from '@/context/AppDataContext';
import { useAuth } from '@/context/AuthContext';

export default function NotificationsScreen() {
  const {
    notifications,
    loadNotificationsIfNeeded,
    refreshNotifications,
    refreshNotificationUnreadCount,
    loadNotificationUnreadCountIfNeeded,
  } = useAppData();
  const { user, isLoading: authLoading, isPending } = useAuth();

  useEffect(() => {
    if (authLoading || !user || isPending) {
      if (!authLoading && !user) {
        router.replace('/login');
      }
      return;
    }

    void loadNotificationsIfNeeded();
    void loadNotificationUnreadCountIfNeeded();
  }, [authLoading, user, isPending, loadNotificationsIfNeeded, loadNotificationUnreadCountIfNeeded]);

  const handleRefresh = () => {
    void Promise.all([refreshNotifications(), refreshNotificationUnreadCount()]);
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationService.markAllAsRead();
      await Promise.all([refreshNotifications(), refreshNotificationUnreadCount()]);
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
    }
  };

  const handleNotificationPress = async (item: AppNotification) => {
    if (!item.read) {
      try {
        await notificationService.markAsRead(item.id);
        await refreshNotificationUnreadCount();
      } catch (error) {
        console.error('Error marking notification as read:', error);
      }
    }

    // Optional: Navigate based on payload/type
    if (item.payload) {
      if (item.payload.trip_id) {
        router.push('/trips');
      } else {
        router.push('/trips');
      }
    }
  };

  const getIconConfig = (type: string | null) => {
    switch (type) {
      case 'proposal':
      case 'proposta':
        return {
          name: 'document-text-outline' as const,
          color: '#3B82F6',
          bgColor: '#3B82F622',
        };
      case 'trip':
      case 'viagem':
        return {
          name: 'bus-outline' as const,
          color: '#22C55E',
          bgColor: '#22C55E22',
        };
      case 'payment':
      case 'pagamento':
        return {
          name: 'wallet-outline' as const,
          color: '#FACC15',
          bgColor: '#FACC1522',
        };
      default:
        return {
          name: 'notifications-outline' as const,
          color: '#A855F7',
          bgColor: '#A855F722',
        };
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('pt-MZ', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (e) {
      return dateStr;
    }
  };

  if (authLoading || !user || isPending) {
    return (
      <View style={styles.container}>
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <FlowScreenHeader title="Notificações" onBack={() => router.back()} />
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color={FretixColors.yellow} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <FlowScreenHeader title="Notificações" onBack={() => router.back()} />

        <View style={styles.headerActions}>
          <Text style={styles.subTitle}>Centro de Notificações</Text>
          {notifications.data.some((n) => !n.read) && (
            <Pressable
              onPress={handleMarkAllRead}
              style={styles.markReadButton}
              accessibilityRole="button"
              accessibilityLabel="Marcar todas como lidas"
              id="btn-mark-all-read"
            >
              <Text style={styles.markReadText}>Marcar todas como lidas</Text>
            </Pressable>
          )}
        </View>

        {notifications.isLoading && !notifications.isLoaded ? (
          <SkeletonNotificationList count={5} />
        ) : notifications.data.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="notifications-off-outline" size={48} color={FretixColors.grayLight} />
            </View>
            <Text style={styles.emptyTextTitle}>Nenhuma notificação</Text>
            <Text style={styles.emptyTextSub}>
              Fique atento! Novas propostas, viagens e atualizações de pagamento aparecerão aqui.
            </Text>
          </View>
        ) : (
          <FlatList
            data={notifications.data}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={notifications.isRefreshing}
                onRefresh={handleRefresh}
                tintColor={FretixColors.yellow}
                colors={[FretixColors.yellow]}
              />
            }
            renderItem={({ item }) => {
              const iconConfig = getIconConfig(item.notification_type);
              return (
                <Pressable
                  onPress={() => handleNotificationPress(item)}
                  style={[styles.card, !item.read && styles.cardUnread]}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}: ${item.body}`}
                  id={`notification-card-${item.id}`}
                >
                  <View style={[styles.iconWrap, { backgroundColor: iconConfig.bgColor }]}>
                    <Ionicons name={iconConfig.name} size={20} color={iconConfig.color} />
                  </View>

                  <View style={styles.main}>
                    <View style={styles.topRow}>
                      <Text style={[styles.title, !item.read && styles.titleUnread]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      {!item.read && <View style={styles.unreadDot} />}
                    </View>
                    <Text style={styles.body}>{item.body}</Text>
                    <Text style={styles.date}>{formatDate(item.created_at)}</Text>
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
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: 16,
    marginBottom: 8,
  },
  subTitle: {
    color: FretixColors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  markReadButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  markReadText: {
    color: FretixColors.yellow,
    fontSize: 12,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  list: {
    padding: 16,
    gap: 12,
  },
  card: {
    flexDirection: 'row',
    backgroundColor: '#111723',
    borderWidth: 1,
    borderColor: '#273444',
    borderRadius: 12,
    padding: 12,
    gap: 12,
  },
  cardUnread: {
    borderColor: '#3B82F6aa',
    backgroundColor: '#151E2E',
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  main: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    flex: 1,
    color: '#AAB2BE',
    fontSize: 14,
    fontWeight: '600',
  },
  titleUnread: {
    color: FretixColors.white,
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#3B82F6',
    marginLeft: 8,
  },
  body: {
    color: FretixColors.grayLight,
    fontSize: 12,
    lineHeight: 18,
  },
  date: {
    color: '#5F6773',
    fontSize: 10,
    marginTop: 4,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
    gap: 12,
  },
  emptyIconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#111723',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  emptyTextTitle: {
    color: FretixColors.white,
    fontSize: 18,
    fontWeight: '700',
  },
  emptyTextSub: {
    color: FretixColors.grayLight,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
