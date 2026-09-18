import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { type Href, router } from 'expo-router';
import type { ComponentProps } from 'react';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { UserAvatar } from '@/components/user-avatar';
import { CustomDialog } from '@/components/custom-dialog';
import { getUserRoleLabel } from '@/utils/user-role';

import { BottomTabInset, FretixColors } from '@/constants/theme';
import { tripService } from '@/services/trips';
import { vehicleService } from '@/services/vehicles';

type ActivityStat = {
  label: string;
  value: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  highlighted?: boolean;
};

type MenuItem = {
  title: string;
  subtitle: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  href?: Href;
  danger?: boolean;
};



const menuItems: MenuItem[] = [
  {
    title: 'Informacoes pessoais',
    subtitle: 'Gerencie seus dados pessoais',
    icon: 'person',
    color: '#FFC107',
    href: '/personal-information',
  },

  {
    title: 'Notificacoes',
    subtitle: 'Alertas do app',
    icon: 'notifications',
    color: '#A855F7',
    href: '/notifications',
  },
  {
    title: 'Suporte',
    subtitle: 'Central de ajuda e contato',
    icon: 'headset',
    color: '#9CA3AF',
  },
  {
    title: 'Sair da conta',
    subtitle: 'Fazer logout do aplicativo',
    icon: 'log-out-outline',
    color: '#EF4444',
    danger: true,
  },
];

const activityRoutes: Record<string, Href> = {
  'Em andamento': { pathname: '/trips' },
  Concluidas: { pathname: '/trips' },
};

function withAlpha(hexColor: string | undefined, alpha: number) {
  if (!hexColor) return `rgba(0, 0, 0, ${alpha})`;
  const hex = hexColor.replace('#', '');
  const normalized = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
  const int = Number.parseInt(normalized, 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function ProfileScreen() {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
  };

  const [inProgressCount, setInProgressCount] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [vehicleCount, setVehicleCount] = useState(0);
  const [loadingStats, setLoadingStats] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const [inProgressTrips, completedTrips, vehicles] = await Promise.all([
          tripService.getMyTrips('em_andamento'),
          tripService.getMyTrips('concluidas'),
          vehicleService.getMyVehicles(),
        ]);
        setInProgressCount(inProgressTrips.length);
        setCompletedCount(completedTrips.length);
        setVehicleCount(vehicles.length);
      } catch (error) {
        console.error('Erro ao carregar estatísticas do motorista:', error);
      } finally {
        setLoadingStats(false);
      }
    })();
  }, []);

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ProfileHeader />
          <UserProfileSection user={user} />
          <SummaryCards vehicleCount={vehicleCount} />
          <ActivitiesSection
            inProgressCount={inProgressCount}
            completedCount={completedCount}
            vehicleCount={vehicleCount}
            loading={loadingStats}
          />
          <MenuSection onLogout={handleLogout} />
          <Text style={styles.version}>Fretix v1.0.0</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function ProfileHeader() {
  return (
    <View style={styles.profileHeader}>
      <View style={styles.headerSide} />
      <Text style={styles.logoText} numberOfLines={1}>
        Fret<Text style={styles.logoAccent}>ix</Text>
      </Text>
      <Pressable style={styles.headerSide} accessibilityRole="button" accessibilityLabel="Definicoes">
        <Ionicons name="settings-outline" size={22} color={FretixColors.white} />
      </Pressable>
    </View>
  );
}

function UserProfileSection({ user }: { user: any }) {
  const { updateUser } = useAuth();
  const [isUpdating, setIsUpdating] = useState(false);
  const [dialog, setDialog] = useState({ visible: false, title: '', message: '', type: 'info' as 'success' | 'error' | 'info' });

  const handleSelectPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
        base64: true,
      });

      if (!result.canceled && result.assets[0]) {
        setIsUpdating(true);
        const base64Image = `data:image/jpeg;base64,${result.assets[0].base64}`;
        await updateUser({ profile_photo: base64Image });
        setDialog({ visible: true, title: 'Sucesso', message: 'Foto de perfil atualizada!', type: 'success' });
      }
    } catch (error) {
      console.error('Erro ao atualizar foto:', error);
      setDialog({ visible: true, title: 'Erro', message: 'Não foi possível atualizar a foto de perfil.', type: 'error' });
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <View style={styles.userSection}>
      <View style={styles.avatarWrap}>
        <UserAvatar photo={user?.profile_photo} style={styles.avatar} />
        <Pressable
          style={styles.cameraButton}
          onPress={handleSelectPhoto}
          disabled={isUpdating}
          accessibilityRole="button"
          accessibilityLabel="Alterar foto">
          {isUpdating ? (
            <ActivityIndicator size="small" color="#101217" />
          ) : (
            <Ionicons name="camera" size={14} color="#101217" />
          )}
        </Pressable>
      </View>

      <View style={styles.userMain}>
        <View style={styles.nameRow}>
          <View style={styles.nameBlock}>
            <View style={styles.nameLine}>
              <Text style={styles.userName}>{user?.name || 'Manuel Joao'}</Text>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark" size={10} color="#101217" />
              </View>
            </View>
            <View style={styles.roleBadge}>
              <Ionicons name="person" size={11} color="#C6F6D5" />
              <Text style={styles.roleText}>{getUserRoleLabel(user)}</Text>
            </View>
          </View>

          <Pressable
            style={styles.editButton}
            onPress={() => router.push('/personal-information')}
            accessibilityRole="button">
            <Ionicons name="create-outline" size={13} color={FretixColors.yellow} />
            <Text style={styles.editButtonText}>Editar perfil</Text>
          </Pressable>
        </View>

        <View style={styles.contactRow}>
          <Ionicons name="call-outline" size={13} color={FretixColors.grayLight} />
          <Text style={styles.contactText}>{user?.phone || '+258 84 123 4567'}</Text>
        </View>
        <View style={styles.contactRow}>
          <Ionicons name="mail-outline" size={13} color={FretixColors.grayLight} />
          <Text style={styles.contactText}>{user?.email || 'manueljoao@email.com'}</Text>
        </View>
      </View>

      <CustomDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        type={dialog.type}
        confirmText="OK"
        onConfirm={() => setDialog({ visible: false, title: '', message: '', type: 'info' })}
      />
    </View>
  );
}

function SummaryCards({ vehicleCount }: { vehicleCount: number }) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryCard}>
        <Ionicons
          name="bus"
          size={52}
          color={withAlpha(FretixColors.yellow, 0.12)}
          style={styles.summaryWatermark}
        />
        <Text style={styles.summaryLabel}>Camiões atribuídos</Text>
        <View style={styles.summaryValueRow}>
          <Text style={styles.summaryValue}>{vehicleCount}</Text>
          <Ionicons name="car-outline" size={15} color={FretixColors.grayLight} />
        </View>
        <Text style={styles.summaryLink}>Ligados ao seu perfil</Text>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.pointsIconWrap}>
          <Ionicons name="navigate" size={16} color={FretixColors.yellow} />
        </View>
        <Text style={styles.summaryLabel}>Acompanhamento</Text>
        <Text style={styles.summaryValue}>Viagens e carga</Text>
        <Text style={styles.summaryLink}>Use a aba Viagens</Text>
      </View>
    </View>
  );
}

function ActivitiesSection({
  inProgressCount,
  completedCount,
  vehicleCount,
  loading
}: {
  inProgressCount: number;
  completedCount: number;
  vehicleCount: number;
  loading: boolean;
}) {
  const stats: ActivityStat[] = [
    { label: 'Camiões', value: loading ? '...' : String(vehicleCount), icon: 'bus', color: '#FFC107', highlighted: true },
    { label: 'Em andamento', value: loading ? '...' : String(inProgressCount), icon: 'navigate', color: '#22C55E' },
    { label: 'Concluidas', value: loading ? '...' : String(completedCount), icon: 'checkmark-circle', color: '#3B82F6' },
    { label: 'Avaliacao', value: '—', icon: 'star', color: '#A855F7' },
  ];

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Minhas atividades</Text>
      <View style={styles.activitiesRow}>
        {stats.map((item) => (
          <Pressable
            key={item.label}
            onPress={
              activityRoutes[item.label] ? () => router.push(activityRoutes[item.label]) : undefined
            }
            style={[styles.activityCard, item.highlighted && styles.activityCardHighlighted]}>
            <View style={[styles.activityIconWrap, { backgroundColor: withAlpha(item.color, 0.16) }]}>
              {loading ? (
                <ActivityIndicator size="small" color={item.color} />
              ) : (
                <Ionicons name={item.icon} size={15} color={item.color} />
              )}
            </View>
            <Text style={styles.activityValue}>{item.value}</Text>
            <Text style={styles.activityLabel} numberOfLines={2} ellipsizeMode="tail">
              {item.label}
            </Text>
            <Ionicons name="chevron-forward" size={11} color={item.color} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MenuSection({ onLogout }: { onLogout: () => void }) {
  const items = menuItems;

  return (
    <View style={styles.menuSection}>
      {items.map((item, index) => (
        <Pressable
          key={item.title}
          onPress={() => {
            if (item.danger) {
              onLogout();
            } else if (item.href) {
              router.push(item.href);
            }
          }}
          style={[styles.menuItem, index < items.length - 1 && styles.menuItemBorder]}>
          <View style={[styles.menuIconWrap, { backgroundColor: withAlpha(item.color, 0.16) }]}>
            <Ionicons name={item.icon} size={18} color={item.color} />
          </View>
          <View style={styles.menuTextWrap}>
            <Text style={[styles.menuTitle, item.danger && styles.menuTitleDanger]}>{item.title}</Text>
            <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#6B7280" />
        </Pressable>
      ))}
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
  content: {
    paddingHorizontal: 16,
    paddingBottom: BottomTabInset + 16,
    gap: 16,
  },
  profileHeader: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerSide: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: FretixColors.white,
    fontSize: 26,
    fontWeight: '700',
  },
  logoAccent: {
    color: FretixColors.yellow,
  },
  userSection: {
    flexDirection: 'row',
    gap: 14,
    alignItems: 'flex-start',
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: '#273444',
    backgroundColor: '#111723',
  },
  cameraButton: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: FretixColors.black,
  },
  userMain: {
    flex: 1,
    gap: 6,
    paddingTop: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  nameBlock: {
    flex: 1,
    gap: 6,
  },
  nameLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  userName: {
    color: FretixColors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  verifiedBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: '#14532D',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  roleText: {
    color: '#C6F6D5',
    fontSize: 11,
    fontWeight: '600',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderColor: FretixColors.yellow,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },
  editButtonText: {
    color: FretixColors.yellow,
    fontSize: 11,
    fontWeight: '700',
  },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  contactText: {
    color: FretixColors.grayLight,
    fontSize: 12,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 10,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#111723',
    borderWidth: 1,
    borderColor: '#273444',
    borderRadius: 14,
    padding: 12,
    minHeight: 118,
    overflow: 'hidden',
    justifyContent: 'space-between',
    gap: 4,
  },
  summaryWatermark: {
    position: 'absolute',
    right: -6,
    bottom: -8,
  },
  pointsIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: withAlpha(FretixColors.yellow, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  summaryLabel: {
    color: FretixColors.grayLight,
    fontSize: 11,
    marginTop: 2,
  },
  summaryValueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  summaryValue: {
    color: FretixColors.white,
    fontSize: 17,
    fontWeight: '700',
    flexShrink: 1,
  },
  summaryLink: {
    color: FretixColors.yellow,
    fontSize: 11,
    fontWeight: '600',
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: FretixColors.white,
    fontSize: 20,
    fontWeight: '700',
  },
  activitiesRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
    gap: 5,
  },
  activityCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: '#111723',
    borderWidth: 1,
    borderColor: '#273444',
    borderRadius: 14,
    paddingHorizontal: 4,
    paddingVertical: 10,
    gap: 3,
    minHeight: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityCardHighlighted: {
    borderColor: FretixColors.yellow,
    backgroundColor: '#1A1708',
  },
  activityIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityValue: {
    color: FretixColors.white,
    fontSize: 17,
    fontWeight: '700',
  },
  activityLabel: {
    color: FretixColors.grayLight,
    fontSize: 8,
    lineHeight: 11,
    textAlign: 'center',
    width: '100%',
  },
  menuSection: {
    backgroundColor: '#111723',
    borderWidth: 1,
    borderColor: '#273444',
    borderRadius: 14,
    overflow: 'hidden',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  menuItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#273444',
  },
  menuIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTextWrap: {
    flex: 1,
    gap: 2,
  },
  menuTitle: {
    color: FretixColors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  menuTitleDanger: {
    color: '#FCA5A5',
  },
  menuSubtitle: {
    color: FretixColors.grayLight,
    fontSize: 11,
    lineHeight: 15,
  },
  version: {
    color: '#6B7280',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
});
