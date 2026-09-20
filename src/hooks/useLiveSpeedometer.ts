import { useEffect, useRef, useState } from 'react';
import * as Location from 'expo-location';

type SpeedometerState = {
  speedKmh: number;
  permissionGranted: boolean;
  locationEnabled: boolean;
};

const toRadians = (value: number) => (value * Math.PI) / 180;

const distanceMeters = (
  first: Location.LocationObject,
  second: Location.LocationObject,
) => {
  const radius = 6_371_000;
  const lat1 = toRadians(first.coords.latitude);
  const lat2 = toRadians(second.coords.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(second.coords.longitude - first.coords.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export function useLiveSpeedometer(enabled = true): SpeedometerState {
  const [state, setState] = useState<SpeedometerState>({
    speedKmh: 0,
    permissionGranted: false,
    locationEnabled: true,
  });
  const previousRef = useRef<Location.LocationObject | null>(null);
  const smoothedSpeedRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    let subscription: Location.LocationSubscription | null = null;

    const start = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!mounted) return;
      const granted = permission.status === 'granted';
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      setState((current) => ({
        ...current,
        permissionGranted: granted,
        locationEnabled: servicesEnabled,
      }));
      if (!granted || !servicesEnabled) return;

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 1000,
          distanceInterval: 1,
          mayShowUserSettingsDialog: true,
        },
        (position) => {
          const gpsSpeed = position.coords.speed;
          let speedKmh =
            typeof gpsSpeed === 'number' && Number.isFinite(gpsSpeed) && gpsSpeed >= 0
              ? gpsSpeed * 3.6
              : null;

          if (speedKmh == null && previousRef.current) {
            const elapsedSeconds = (position.timestamp - previousRef.current.timestamp) / 1000;
            if (elapsedSeconds > 0) {
              speedKmh = (distanceMeters(previousRef.current, position) / elapsedSeconds) * 3.6;
            }
          }

          previousRef.current = position;
          const safeSpeed = Math.max(0, Math.min(speedKmh ?? 0, 220));
          smoothedSpeedRef.current = smoothedSpeedRef.current * 0.55 + safeSpeed * 0.45;
          if (mounted) {
            setState({
              speedKmh: Math.round(smoothedSpeedRef.current),
              permissionGranted: true,
              locationEnabled: true,
            });
          }
        },
      );
    };

    void start();
    return () => {
      mounted = false;
      subscription?.remove();
      previousRef.current = null;
      smoothedSpeedRef.current = 0;
    };
  }, [enabled]);

  return state;
}
