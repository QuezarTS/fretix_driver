import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useAuth } from '@/context/AuthContext';
import { loadService } from '@/services/loads';
import { notificationService, type AppNotification } from '@/services/notifications';
import { proposalService, type LoadProposal } from '@/services/proposals';
import { vehicleService } from '@/services/vehicles';
import {
  createResourceState,
  initialAppDataState,
  type AppDataState,
  type ResourceState,
} from '@/types/app-data';

type FetchMode = 'initial' | 'refresh';

type AppDataContextType = AppDataState & {
  loadLoadTypesIfNeeded: () => Promise<void>;
  loadMarketplaceIfNeeded: () => Promise<void>;
  refreshMarketplace: () => Promise<void>;
  loadAvailableVehiclesIfNeeded: () => Promise<void>;
  refreshAvailableVehicles: () => Promise<void>;
  loadMyLoadsIfNeeded: () => Promise<void>;
  refreshMyLoads: () => Promise<void>;
  loadMyProposalsIfNeeded: () => Promise<void>;
  refreshMyProposals: () => Promise<void>;
  loadReceivedProposalsIfNeeded: () => Promise<void>;
  refreshReceivedProposals: () => Promise<void>;
  loadNotificationsIfNeeded: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  loadNotificationUnreadCountIfNeeded: () => Promise<void>;
  refreshNotificationUnreadCount: () => Promise<void>;
  ingestRealtimeNotification: (notification: AppNotification) => void;
  getCachedLoadById: (id: number | null | undefined) => AppDataState['availableLoads']['data'][number] | undefined;
  getCachedVehicleById: (id: number | null | undefined) => AppDataState['availableVehicles']['data'][number] | undefined;
  getCachedProposalById: (id: number | null | undefined) => LoadProposal | undefined;
  invalidateAll: () => void;
};

const AppDataContext = createContext<AppDataContextType | undefined>(undefined);

function beginFetch<T>(
  prev: ResourceState<T>,
  mode: FetchMode
): ResourceState<T> {
  return {
    ...prev,
    isLoading: mode === 'initial' && !prev.isLoaded,
    isRefreshing: mode === 'refresh',
    error: null,
  };
}

function finishFetch<T>(data: T): ResourceState<T> {
  return {
    data,
    isLoading: false,
    isRefreshing: false,
    isLoaded: true,
    error: null,
  };
}

function failFetch<T>(prev: ResourceState<T>, error: string): ResourceState<T> {
  return {
    ...prev,
    isLoading: false,
    isRefreshing: false,
    error,
  };
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const { user, isPending, isClient, isCompany, isDriver, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<AppDataState>(initialAppDataState);

  const invalidateAll = useCallback(() => {
    setState(initialAppDataState);
  }, []);

  useEffect(() => {
    if (!user || isPending || authLoading) {
      invalidateAll();
    }
  }, [user, isPending, authLoading, invalidateAll]);

  const fetchLoadTypes = useCallback(async (mode: FetchMode) => {
    setState((prev) => ({
      ...prev,
      loadTypes: beginFetch(prev.loadTypes, mode),
    }));

    try {
      const data = await loadService.getLoadTypes();
      setState((prev) => ({
        ...prev,
        loadTypes: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch load types:', error);
      setState((prev) => ({
        ...prev,
        loadTypes: failFetch(prev.loadTypes, 'Falha ao carregar tipos de carga'),
      }));
    }
  }, []);

  const fetchDashboardStats = useCallback(async (mode: FetchMode) => {
    setState((prev) => ({
      ...prev,
      dashboardStats: beginFetch(prev.dashboardStats, mode),
    }));

    try {
      const data = await loadService.getDashboardStats();
      setState((prev) => ({
        ...prev,
        dashboardStats: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
      setState((prev) => ({
        ...prev,
        dashboardStats: failFetch(prev.dashboardStats, 'Falha ao carregar estatísticas'),
      }));
    }
  }, []);

  const fetchAvailableLoads = useCallback(async (mode: FetchMode) => {
    setState((prev) => ({
      ...prev,
      availableLoads: beginFetch(prev.availableLoads, mode),
    }));

    try {
      const data = await loadService.getAvailableLoads();
      setState((prev) => ({
        ...prev,
        availableLoads: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch available loads:', error);
      setState((prev) => ({
        ...prev,
        availableLoads: failFetch(prev.availableLoads, 'Falha ao carregar cargas'),
      }));
    }
  }, []);

  const fetchAvailableVehicles = useCallback(async (mode: FetchMode) => {
    setState((prev) => ({
      ...prev,
      availableVehicles: beginFetch(prev.availableVehicles, mode),
    }));

    try {
      const data = await vehicleService.getAvailableVehicles();
      setState((prev) => ({
        ...prev,
        availableVehicles: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch available vehicles:', error);
      setState((prev) => ({
        ...prev,
        availableVehicles: failFetch(prev.availableVehicles, 'Falha ao carregar camiões'),
      }));
    }
  }, []);

  const fetchMyLoads = useCallback(async (mode: FetchMode) => {
    if (!isClient && !isCompany && !isDriver) {
      return;
    }

    setState((prev) => ({
      ...prev,
      myLoads: beginFetch(prev.myLoads, mode),
    }));

    try {
      const data = await loadService.getMyLoads();
      setState((prev) => ({
        ...prev,
        myLoads: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch my loads:', error);
      setState((prev) => ({
        ...prev,
        myLoads: failFetch(prev.myLoads, 'Falha ao carregar as suas cargas'),
      }));
    }
  }, [isClient, isCompany, isDriver]);

  const fetchMyProposals = useCallback(async (mode: FetchMode) => {
    if (!isCompany) {
      return;
    }

    setState((prev) => ({
      ...prev,
      myProposals: beginFetch(prev.myProposals, mode),
    }));

    try {
      const data = await proposalService.getMyProposals();
      setState((prev) => ({
        ...prev,
        myProposals: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch my proposals:', error);
      setState((prev) => ({
        ...prev,
        myProposals: failFetch(prev.myProposals, 'Falha ao carregar propostas'),
      }));
    }
  }, [isCompany]);

  const fetchReceivedProposals = useCallback(async (mode: FetchMode) => {
    if (!isClient) {
      return;
    }

    setState((prev) => ({
      ...prev,
      receivedProposals: beginFetch(prev.receivedProposals, mode),
    }));

    try {
      const data = await proposalService.getReceivedProposals();
      setState((prev) => ({
        ...prev,
        receivedProposals: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch received proposals:', error);
      setState((prev) => ({
        ...prev,
        receivedProposals: failFetch(prev.receivedProposals, 'Falha ao carregar propostas'),
      }));
    }
  }, [isClient]);

  const fetchNotifications = useCallback(async (mode: FetchMode) => {
    setState((prev) => ({
      ...prev,
      notifications: beginFetch(prev.notifications, mode),
    }));

    try {
      const data = await notificationService.getNotifications();
      setState((prev) => ({
        ...prev,
        notifications: finishFetch(data),
      }));
    } catch (error) {
      console.error('Failed to fetch notifications:', error);
      setState((prev) => ({
        ...prev,
        notifications: failFetch(prev.notifications, 'Falha ao carregar notificações'),
      }));
    }
  }, []);

  const fetchNotificationUnreadCount = useCallback(async (mode: FetchMode) => {
    setState((prev) => ({
      ...prev,
      notificationUnreadCount: beginFetch(prev.notificationUnreadCount, mode),
    }));

    try {
      const count = await notificationService.getUnreadCount();
      setState((prev) => ({
        ...prev,
        notificationUnreadCount: finishFetch(count),
      }));
    } catch (error) {
      console.error('Failed to fetch unread notification count:', error);
      setState((prev) => ({
        ...prev,
        notificationUnreadCount: failFetch(
          prev.notificationUnreadCount,
          'Falha ao carregar contador de notificações',
        ),
      }));
    }
  }, []);

  const loadLoadTypesIfNeeded = useCallback(async () => {
    if (state.loadTypes.isLoaded || state.loadTypes.isLoading) {
      return;
    }
    await fetchLoadTypes('initial');
  }, [state.loadTypes.isLoaded, state.loadTypes.isLoading, fetchLoadTypes]);

  const loadMarketplaceIfNeeded = useCallback(async () => {
    const tasks: Promise<void>[] = [];

    if (!state.loadTypes.isLoaded && !state.loadTypes.isLoading) {
      tasks.push(fetchLoadTypes('initial'));
    }
    if (!state.dashboardStats.isLoaded && !state.dashboardStats.isLoading) {
      tasks.push(fetchDashboardStats('initial'));
    }
    if (!state.availableLoads.isLoaded && !state.availableLoads.isLoading) {
      tasks.push(fetchAvailableLoads('initial'));
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
  }, [
    state.loadTypes.isLoaded,
    state.loadTypes.isLoading,
    state.dashboardStats.isLoaded,
    state.dashboardStats.isLoading,
    state.availableLoads.isLoaded,
    state.availableLoads.isLoading,
    fetchLoadTypes,
    fetchDashboardStats,
    fetchAvailableLoads,
  ]);

  const refreshMarketplace = useCallback(async () => {
    await Promise.all([
      fetchDashboardStats('refresh'),
      fetchAvailableLoads('refresh'),
    ]);
  }, [fetchDashboardStats, fetchAvailableLoads]);

  const loadAvailableVehiclesIfNeeded = useCallback(async () => {
    if (state.availableVehicles.isLoaded || state.availableVehicles.isLoading) {
      return;
    }
    await fetchAvailableVehicles('initial');
  }, [
    state.availableVehicles.isLoaded,
    state.availableVehicles.isLoading,
    fetchAvailableVehicles,
  ]);

  const refreshAvailableVehicles = useCallback(async () => {
    await fetchAvailableVehicles('refresh');
  }, [fetchAvailableVehicles]);

  const loadMyLoadsIfNeeded = useCallback(async () => {
    if (state.myLoads.isLoaded || state.myLoads.isLoading) {
      return;
    }
    await fetchMyLoads('initial');
  }, [state.myLoads.isLoaded, state.myLoads.isLoading, fetchMyLoads]);

  const refreshMyLoads = useCallback(async () => {
    await fetchMyLoads('refresh');
  }, [fetchMyLoads]);

  const loadMyProposalsIfNeeded = useCallback(async () => {
    if (state.myProposals.isLoaded || state.myProposals.isLoading) {
      return;
    }
    await fetchMyProposals('initial');
  }, [state.myProposals.isLoaded, state.myProposals.isLoading, fetchMyProposals]);

  const refreshMyProposals = useCallback(async () => {
    await fetchMyProposals('refresh');
  }, [fetchMyProposals]);

  const loadReceivedProposalsIfNeeded = useCallback(async () => {
    if (state.receivedProposals.isLoaded || state.receivedProposals.isLoading) {
      return;
    }
    await fetchReceivedProposals('initial');
  }, [
    state.receivedProposals.isLoaded,
    state.receivedProposals.isLoading,
    fetchReceivedProposals,
  ]);

  const refreshReceivedProposals = useCallback(async () => {
    await fetchReceivedProposals('refresh');
  }, [fetchReceivedProposals]);

  const loadNotificationsIfNeeded = useCallback(async () => {
    if (!user || isPending || authLoading) {
      return;
    }
    if (state.notifications.isLoaded || state.notifications.isLoading) {
      return;
    }
    await fetchNotifications('initial');
  }, [user, isPending, authLoading, state.notifications.isLoaded, state.notifications.isLoading, fetchNotifications]);

  const refreshNotifications = useCallback(async () => {
    await fetchNotifications('refresh');
  }, [fetchNotifications]);

  const loadNotificationUnreadCountIfNeeded = useCallback(async () => {
    if (!user || isPending || authLoading) {
      return;
    }
    if (state.notificationUnreadCount.isLoaded || state.notificationUnreadCount.isLoading) {
      return;
    }
    await fetchNotificationUnreadCount('initial');
  }, [
    user,
    isPending,
    authLoading,
    state.notificationUnreadCount.isLoaded,
    state.notificationUnreadCount.isLoading,
    fetchNotificationUnreadCount,
  ]);

  const refreshNotificationUnreadCount = useCallback(async () => {
    await fetchNotificationUnreadCount('refresh');
  }, [fetchNotificationUnreadCount]);

  useEffect(() => {
    if (!user || isPending || authLoading) {
      return;
    }

    void Promise.all([
      loadNotificationsIfNeeded(),
      loadNotificationUnreadCountIfNeeded(),
    ]);
  }, [user, isPending, authLoading, loadNotificationsIfNeeded, loadNotificationUnreadCountIfNeeded]);

  const ingestRealtimeNotification = useCallback((notification: AppNotification) => {
    setState((prev) => {
      const next = { ...prev };

      if (prev.notifications.isLoaded) {
        const existing = prev.notifications.data;
        const already = existing.some((item) => item.id === notification.id);
        next.notifications = finishFetch(already ? existing : [notification, ...existing]);
      }

      if (prev.notificationUnreadCount.isLoaded && !notification.read) {
        next.notificationUnreadCount = finishFetch(prev.notificationUnreadCount.data + 1);
      }

      return next;
    });
  }, []);

  const getCachedLoadById = useCallback(
    (id: number | null | undefined) => {
      if (id == null) return undefined;

      return (
        state.availableLoads.data.find((item) => item.id === id) ??
        state.myLoads.data.find((item) => item.id === id)
      );
    },
    [state.availableLoads.data, state.myLoads.data],
  );

  const getCachedVehicleById = useCallback(
    (id: number | null | undefined) => {
      if (id == null) return undefined;
      return state.availableVehicles.data.find(
        (item) => item.id === id,
      );
    },
    [state.availableVehicles.data],
  );

  const getCachedProposalById = useCallback(
    (id: number | null | undefined) => {
      if (id == null) return undefined;

      return (
        state.myProposals.data.find((item) => item.id === id) ??
        state.receivedProposals.data.find(
          (item) => item.id === id,
        )
      );
    },
    [state.myProposals.data, state.receivedProposals.data],
  );

  const value = useMemo<AppDataContextType>(
    () => ({
      ...state,
      loadLoadTypesIfNeeded,
      loadMarketplaceIfNeeded,
      refreshMarketplace,
      loadAvailableVehiclesIfNeeded,
      refreshAvailableVehicles,
      loadMyLoadsIfNeeded,
      refreshMyLoads,
      loadMyProposalsIfNeeded,
      refreshMyProposals,
      loadReceivedProposalsIfNeeded,
      refreshReceivedProposals,
      loadNotificationsIfNeeded,
      refreshNotifications,
      loadNotificationUnreadCountIfNeeded,
      refreshNotificationUnreadCount,
      ingestRealtimeNotification,
      getCachedLoadById,
      getCachedVehicleById,
      getCachedProposalById,
      invalidateAll,
    }),
    [
      state,
      loadLoadTypesIfNeeded,
      loadMarketplaceIfNeeded,
      refreshMarketplace,
      loadAvailableVehiclesIfNeeded,
      refreshAvailableVehicles,
      loadMyLoadsIfNeeded,
      refreshMyLoads,
      loadMyProposalsIfNeeded,
      refreshMyProposals,
      loadReceivedProposalsIfNeeded,
      refreshReceivedProposals,
      loadNotificationsIfNeeded,
      refreshNotifications,
      loadNotificationUnreadCountIfNeeded,
      refreshNotificationUnreadCount,
      ingestRealtimeNotification,
      getCachedLoadById,
      getCachedVehicleById,
      getCachedProposalById,
      invalidateAll,
    ]
  );

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
}

export function useAppData() {
  const context = useContext(AppDataContext);
  if (context === undefined) {
    throw new Error('useAppData must be used within an AppDataProvider');
  }
  return context;
}
