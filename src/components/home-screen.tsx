import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { router, type Href } from 'expo-router';
import type { ComponentProps } from 'react';
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { getUserRoleLabel } from '@/utils/user-role';

import { BottomTabInset, FretixColors } from '@/constants/theme';
import { TopAppHeader } from '@/components/top-app-header';
import { UserAvatar } from '@/components/user-avatar';

type QuickAction = {
  label: string;
  caption: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  route?: Href;
};

const quickActions: QuickAction[] = [
  { label: 'Minhas Viagens', caption: 'Ver viagens atribuídas', icon: 'car', color: '#22C55E', route: '/trips' },
  { label: 'Viagem Atual', caption: 'Abrir viagem em andamento', icon: 'navigate', color: '#3B82F6', route: '/trips' },
  { label: 'Notificações', caption: 'Alertas da viagem', icon: 'notifications', color: '#F97316', route: '/notifications' },
  { label: 'Perfil', caption: 'Atualize seus dados', icon: 'person', color: '#A855F7', route: '/profile' },
];

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


export function HomeScreen() {
  const { user } = useAuth();

  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
>
          <Header user={user} />
          <QuickActions />
          <PromoCard />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function Header({ user }: { user: any }) {
  const userName = user?.name || 'Joao';
  const roleText = getUserRoleLabel(user);
  const shortName = userName.split(' ')[0];

  return (
    <View style={styles.header}>
      <TopAppHeader />

      <View style={styles.userRow}>
        <UserAvatar photo={user?.profile_photo} style={styles.avatar} />
        <View style={styles.userTextWrap}>
          <Text style={styles.greeting}>Ola, {shortName} 👋</Text>
          <Text style={styles.subtitle}>Bem-vindo de volta!</Text>
          <View style={styles.roleContainer}>

            <Ionicons name="person-outline" size={14} color={FretixColors.yellow} />
            <Text style={styles.role}>{roleText}</Text>
          </View>
        </View>

        <View style={styles.walletCard}>
          <View style={styles.walletMain}>
            <Text style={styles.walletLabel}>Acesso rápido</Text>
            <Text style={styles.walletValue}>Acompanhe suas viagens</Text>
          </View>
          <View style={styles.walletActions}>
            <Ionicons name="navigate" size={18} color={FretixColors.yellow} />
          </View>
        </View>
      </View>
    </View>
  );
}

function QuickActions() {
  const actions = quickActions;

  return (
    <View style={styles.quickActionsRow}>
      {actions.map((item) => (
        <Pressable
          key={item.label}
          style={styles.quickCard}
          onPress={item.route ? () => router.push(item.route) : undefined}
          accessibilityRole="button">
          <Ionicons name={item.icon} size={24} color={item.color} />
          <Text style={styles.quickLabel} numberOfLines={1} ellipsizeMode="tail">
            {item.label}
          </Text>
          <Text style={styles.quickCaption} numberOfLines={1} ellipsizeMode="tail">
            {item.caption}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

function PromoCard() {
  return (
    <ImageBackground
      imageStyle={styles.promoBackgroundImage}
      source={require('../../assets/camiao_cover.png')}
      style={styles.promoCard}>
      <View style={styles.promoOverlay} />
      <View style={styles.promoTextArea}>
        <Text style={styles.promoTitle}>
          Viagens em curso,{"\n"}
          <Text style={styles.promoTitleAccent}>acompanhe rota e carga</Text>
        </Text>
        <Text style={styles.promoSubtitle}>
          Veja as viagens atribuídas ao seu perfil e aos seus camiões, com acompanhamento do trajeto e da carga.
        </Text>
        <Pressable
          style={styles.ctaButton}
          onPress={() => router.push('/trips')}
        >
          <Text style={styles.ctaText}>Ver Viagens</Text>
        </Pressable>
      </View>
    </ImageBackground>
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
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: BottomTabInset + 20,
    gap: 14,
  },
  header: {
    marginTop: 8,
    gap: 14,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 2,
    borderColor: FretixColors.yellow,
    backgroundColor: FretixColors.grayMedium,
  },
  userTextWrap: {
    flex: 1,
    gap: 2,
  },
  greeting: {
    color: FretixColors.white,
    fontSize: 21,
    fontWeight: '700',
  },
  subtitle: {
    color: FretixColors.grayLight,
    fontSize: 13,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,193,7,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,193,7,0.2)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  role: {
    color: FretixColors.yellow,
    fontSize: 12,
    fontWeight: '600',
  },
  walletCard: {
    backgroundColor: 'rgba(11,15,20,0.72)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    minWidth: 142,
    minHeight: 65,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  walletMain: {
    flex: 1,
  },
  walletLabel: {
    color: FretixColors.grayLight,
    fontSize: 11,
  },
  walletValue: {
    color: FretixColors.white,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  walletActions: {
    alignSelf: 'stretch',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 1,
  },
  depositButton: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: FretixColors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    justifyContent: 'space-between',
    gap: 6,
  },
  quickCard: {
    backgroundColor: 'rgba(11,15,20,0.64)',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 12,
    flex: 1,
    minWidth: 0,
    minHeight: 105,
    gap: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  quickLabel: {
    color: FretixColors.white,
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
    textAlign: 'center',
  },
  quickCaption: {
    color: FretixColors.grayLight,
    fontSize: 9,
    textAlign: 'center',
  },
  promoCard: {
    backgroundColor: 'rgba(11,15,20,0.52)',
    borderRadius: 16,
    padding: 14,
    overflow: 'hidden',
    minHeight: 188,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  promoBackgroundImage: {
    borderRadius: 16,
  },
  promoOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(11,15,20,0.28)',
  },
  promoTextArea: {
    width: '56%',
    gap: 8,
    justifyContent: 'center',
  },
  promoTitle: {
    color: FretixColors.white,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },
  promoTitleAccent: {
    color: FretixColors.yellow,
  },
  promoSubtitle: {
    color: FretixColors.grayLight,
    fontSize: 13,
    lineHeight: 18,
  },
  ctaButton: {
    alignSelf: 'flex-start',
    backgroundColor: FretixColors.yellow,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 4,
  },
  ctaText: {
    color: FretixColors.black,
    fontSize: 14,
    fontWeight: '800',
  },
  section: {
    gap: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: FretixColors.white,
    fontSize: 25,
    fontWeight: '700',
  },
  sectionLink: {
    color: FretixColors.yellow,
    fontSize: 13,
    fontWeight: '600',
  },
  activityCard: {
    backgroundColor: '#111824',
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#273241',
  },
  activityIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityMain: {
    flex: 1,
    gap: 2,
  },
  activityId: {
    color: FretixColors.white,
    fontSize: 15,
    fontWeight: '700',
  },
  activityRoute: {
    color: FretixColors.grayLight,
    fontSize: 13,
  },
  activityCargo: {
    color: FretixColors.grayLight,
    fontSize: 12,
  },
  activityMeta: {
    alignItems: 'flex-end',
    gap: 8,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusText: {
    color: FretixColors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  activityTime: {
    color: FretixColors.grayLight,
    fontSize: 12,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 36,
    gap: 8,
    backgroundColor: '#111824',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#273241',
  },
  emptyStateTitle: {
    color: FretixColors.white,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  emptyStateSubtitle: {
    color: FretixColors.grayLight,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 24,
  },
});
