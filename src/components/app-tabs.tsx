import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { TabList, TabSlot, Tabs, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const TAB_BAR_HEIGHT = 70;

export default function AppTabs() {
  const pathname = usePathname();
  const hideTabBar = [
    '/login',
    '/notifications',
    '/personal-information',
    '/trip_details',
    '/trip_stops',
    '/trip_stop_details',
    '/trip_arrival_confirm',
    '/trip_evidence',
  ].includes(pathname);

  const tabSlotStyle = StyleSheet.flatten([
    styles.tabSlot,
    hideTabBar && styles.tabSlotFullScreen,
  ]);

  return (
    <Tabs>
      <TabSlot style={tabSlotStyle} />

      <TabList style={styles.hiddenTabList}>
        <TabTrigger name="index" href="/" />
        <TabTrigger name="trips" href="/trips" />
        <TabTrigger name="profile" href="/profile" />
        <TabTrigger name="notifications" href="/notifications" />
        <TabTrigger name="personal-information" href="/personal-information" />
        <TabTrigger name="trip_details" href="/trip_details" />
        <TabTrigger name="trip_stops" href="/trip_stops" />
        <TabTrigger name="trip_arrival_confirm" href="/trip_arrival_confirm" />
        <TabTrigger name="trip_evidence" href="/trip_evidence" />
      </TabList>

      {!hideTabBar && (
        <View style={styles.container}>
          <TabTrigger name="index" asChild>
            <BottomTabItem label="Inicio" icon="home" />
          </TabTrigger>

          <TabTrigger name="trips" asChild>
            <BottomTabItem label="Viagens" icon="car" />
          </TabTrigger>

          <TabTrigger name="profile" asChild>
            <BottomTabItem label="Perfil" icon="person-outline" />
          </TabTrigger>
        </View>
      )}
    </Tabs>
  );
}

function BottomTabItem({
  label,
  icon,
  isFocused,
  ...props
}: TabTriggerSlotProps & { label: string; icon: ComponentProps<typeof Ionicons>['name'] }) {
  const tint = isFocused ? '#FFC107' : '#8D949E';

  return (
    <Pressable {...props} style={styles.item}>
      <Ionicons name={icon} size={21} color={tint} />
      <Text style={[styles.label, isFocused && styles.labelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabSlot: {
    height: '100%',
    paddingBottom: TAB_BAR_HEIGHT + 24,
    backgroundColor: '#0B0F14',
  },
  tabSlotFullScreen: {
    paddingBottom: 0,
  },
  hiddenTabList: {
    display: 'none',
    height: 0,
    width: 0,
    overflow: 'hidden',
  },
  container: {
    position: 'absolute',
    bottom: 8,
    left: 12,
    right: 12,
    height: TAB_BAR_HEIGHT,
    backgroundColor: '#141C27',
    borderWidth: 1,
    borderColor: '#324051',
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: 6,
    overflow: 'visible',
  },
  item: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 62,
    gap: 2,
  },
  label: {
    color: '#8D949E',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  labelActive: {
    color: '#FFC107',
  },
  publishWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginTop: -18,
    minWidth: 72,
    gap: 1,
  },
  publishLabel: {
    marginTop: 8,
    textAlign: 'center',
  },
  publishCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFC107',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#121923',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 8,
  },
});
