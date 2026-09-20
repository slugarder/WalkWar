import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, Platform } from 'react-native';
import * as Location from 'expo-location';
import { Pedometer } from 'expo-sensors';
import { recordDiagnostic } from './diagnostics';

export type GpsSample = {
  lat: number;
  lon: number;
  accuracyM: number;
  capturedAt: number;
  stepCounter: number;
  sensorEpoch: string;
};

export type GpsTrackerResult = {
  status: string;
  available: boolean;
  detectedSteps: number;
  stepEvents: number;
  refresh: () => Promise<GpsSample>;
};

type LocationSubscription = { remove: () => void };
type StepSubscription = { remove: () => void };

const MAX_LOCATION_AGE_MS = 30_000;
const MAX_LOCATION_FUTURE_MS = 5_000;
const MAX_ACCURACY_M = 50;
const REFRESH_TIMEOUT_MS = 15_000;

function newSensorEpoch(): string {
  // crypto.randomUUID is not present on every Expo target, and the epoch only
  // needs to distinguish foreground subscriptions within this app session.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function errorStatus(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/permission|denied|허용/i.test(message)) return '권한이 필요해요';
  if (/service|provider|location/i.test(message)) return '위치 서비스를 확인해 주세요';
  return '위치 정보를 준비하지 못했어요';
}

function validSample(
  location: Location.LocationObject,
  stepCounter: number,
  sensorEpoch: string,
  now = Date.now(),
): GpsSample {
  const accuracy = location.coords.accuracy;
  if (!Number.isFinite(accuracy)) throw new Error('정확한 위치를 확인하지 못했어요');
  if ((accuracy as number) < 0 || (accuracy as number) > MAX_ACCURACY_M) {
    throw new Error(`위치 정확도 ${Math.round(accuracy as number)}m가 부족해요. 실외에서 정확한 위치를 허용해 주세요`);
  }
  if (!Number.isFinite(location.timestamp)) throw new Error('위치 시간을 확인하지 못했어요');
  const age = now - location.timestamp;
  if (age > MAX_LOCATION_AGE_MS) throw new Error('오래된 위치 정보예요');
  if (age < -MAX_LOCATION_FUTURE_MS) throw new Error('위치 시간이 올바르지 않아요');
  if (!Number.isFinite(location.coords.latitude) || !Number.isFinite(location.coords.longitude)) {
    throw new Error('위치 좌표를 확인하지 못했어요');
  }
  return {
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    accuracyM: accuracy as number,
    capturedAt: location.timestamp,
    stepCounter,
    sensorEpoch,
  };
}

function watchSample(
  location: Location.LocationObject,
  stepCounter: number,
  sensorEpoch: string,
  now = Date.now(),
): GpsSample | undefined {
  if (!Number.isFinite(location.timestamp)) return undefined;
  const age = now - location.timestamp;
  if (age > MAX_LOCATION_AGE_MS || age < -MAX_LOCATION_FUTURE_MS) return undefined;
  if (!Number.isFinite(location.coords.latitude) || !Number.isFinite(location.coords.longitude)) return undefined;
  const rawAccuracy = location.coords.accuracy;
  const accuracyM = Number.isFinite(rawAccuracy) && (rawAccuracy as number) >= 0
    ? rawAccuracy as number
    : 1_000_000_000;
  return {
    lat: location.coords.latitude,
    lon: location.coords.longitude,
    accuracyM,
    capturedAt: location.timestamp,
    stepCounter,
    sensorEpoch,
  };
}

/** Foreground-only physical GPS and pedometer bridge for raid sessions. */
export function useGpsTracker(
  enabled: boolean,
  sessionKey: string,
  onSample: (sample: GpsSample) => void,
): GpsTrackerResult {
  const callbackRef = useRef(onSample);
  const refreshRef = useRef<() => Promise<GpsSample>>(() => Promise.reject(new Error('위치 추적이 아직 준비되지 않았어요')));
  const [result, setResult] = useState<Omit<GpsTrackerResult, 'refresh'>>({
    status: enabled ? '권한을 확인하는 중이에요' : '위치 추적 꺼짐',
    available: false,
    detectedSteps: 0,
    stepEvents: 0,
  });

  // The parent commonly passes an inline callback. Updating this ref keeps
  // that from restarting native subscriptions on every render.
  useEffect(() => {
    callbackRef.current = onSample;
  }, [onSample]);

  useEffect(() => {
    const setTrackerStatus = (status: string, available: boolean) => {
      setResult(previous => ({ ...previous, status, available }));
    };
    let disposed = false;
    let locationSubscription: LocationSubscription | undefined;
    let stepSubscription: StepSubscription | undefined;
    let appStateSubscription: { remove: () => void } | undefined;
    let startGeneration = 0;
    let startupPromise: Promise<void> | undefined;
    let permissionPromptInFlight = false;
    let locationRequestAttempted = false;
    let pedometerRequestAttempted = false;
    let locationPermissionReady = false;
    let refreshPromise: Promise<GpsSample> | undefined;
    let active = AppState.currentState === 'active';
    let lastLocation: Location.LocationObject | undefined;
    let stepBaseline: number | undefined;
    let previousRawSteps: number | undefined;
    let stepCounter = 0;
    let stepEvents = 0;
    let sensorEpoch = newSensorEpoch();

    const clearSubscriptions = () => {
      locationSubscription?.remove();
      stepSubscription?.remove();
      locationSubscription = undefined;
      stepSubscription = undefined;
      lastLocation = undefined;
      locationPermissionReady = false;
      stepBaseline = undefined;
      previousRawSteps = undefined;
      stepCounter = 0;
      stepEvents = 0;
      setResult(previous => ({ ...previous, detectedSteps: 0, stepEvents: 0 }));
    };

    const emit = (location = lastLocation): GpsSample | undefined => {
      if (!lastLocation || disposed || !active) return;
      if (!location) return;
      const sample = watchSample(location, stepCounter, sensorEpoch);
      if (sample) callbackRef.current(sample);
      return sample;
    };

    const startForeground = (): Promise<void> | undefined => {
      if (disposed || !enabled || !active || startupPromise) return startupPromise;
      const generation = ++startGeneration;
      recordDiagnostic('gps-start', 'foreground');
      clearSubscriptions();
      sensorEpoch = newSensorEpoch();
      setTrackerStatus('권한을 확인하는 중이에요', false);

      const promise = (async () => {
        try {
        let locationPermission = await Location.getForegroundPermissionsAsync();
        if (disposed || generation !== startGeneration || !active) return;
        recordDiagnostic('gps-location-permission', `${locationPermission.status}:${locationPermission.canAskAgain}`);
        if (locationPermission.status !== 'granted' && locationPermission.canAskAgain && !locationRequestAttempted) {
          locationRequestAttempted = true;
          permissionPromptInFlight = true;
          recordDiagnostic('gps-location-prompt', 'requested');
          try {
            locationPermission = await Location.requestForegroundPermissionsAsync();
          } finally {
            permissionPromptInFlight = false;
          }
          recordDiagnostic('gps-location-permission', `${locationPermission.status}:${locationPermission.canAskAgain}`);
        }
        if (disposed || generation !== startGeneration || !active) return;
        if (locationPermission.status !== 'granted') {
          recordDiagnostic('gps-stop', 'location-permission');
          setTrackerStatus('위치 권한이 필요해요', false);
          return;
        }
        locationPermissionReady = true;

        let locationServicesEnabled = true;
        try {
          locationServicesEnabled = await Location.hasServicesEnabledAsync();
        } catch {
          // Permission is still enough to attempt a watch on web and some
          // provider implementations, so leave this as an informational check.
        }
        if (!locationServicesEnabled) {
          setTrackerStatus('위치 서비스를 켜 주세요', false);
          return;
        }

        let pedometerAvailable = false;
        if (disposed || generation !== startGeneration || !active) return;
        if (Platform.OS !== 'web') {
          try {
            let pedometerPermission = await Pedometer.getPermissionsAsync();
            if (disposed || generation !== startGeneration || !active) return;
            recordDiagnostic('gps-pedometer-permission', `${pedometerPermission.status}:${pedometerPermission.canAskAgain}`);
            if (pedometerPermission.status !== 'granted' && pedometerPermission.canAskAgain && !pedometerRequestAttempted) {
              pedometerRequestAttempted = true;
              permissionPromptInFlight = true;
              recordDiagnostic('gps-pedometer-prompt', 'requested');
              try {
                pedometerPermission = await Pedometer.requestPermissionsAsync();
              } finally {
                permissionPromptInFlight = false;
              }
              recordDiagnostic('gps-pedometer-permission', `${pedometerPermission.status}:${pedometerPermission.canAskAgain}`);
            }
            pedometerAvailable = pedometerPermission.status === 'granted' &&
              await Pedometer.isAvailableAsync();
          } catch {
            pedometerAvailable = false;
          }
        }

        if (disposed || generation !== startGeneration || !active) return;
        setTrackerStatus(
          pedometerAvailable ? 'GPS와 걸음 수를 추적 중이에요' : 'GPS 추적 중 (걸음 센서 사용 불가)',
          // The parent uses this flag to decide whether to show sensor status.
          // GPS still runs and emits stepCounter=0 when the pedometer is absent.
          pedometerAvailable,
        );

        const nextLocationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            distanceInterval: 0,
            timeInterval: 2_000,
          },
          (location) => {
            if (disposed || generation !== startGeneration || !active) return;
            lastLocation = location;
            emit();
          },
          () => {
            if (!disposed && generation === startGeneration) {
              setTrackerStatus('위치 업데이트를 받지 못했어요', false);
            }
          },
        );
        if (disposed || generation !== startGeneration || !active) {
          nextLocationSubscription.remove();
          return;
        }
        locationSubscription = nextLocationSubscription;

        if (pedometerAvailable && !disposed && generation === startGeneration && active) {
          const nextStepSubscription = Pedometer.watchStepCount((update) => {
            if (disposed || generation !== startGeneration || !active) return;
            if (!Number.isFinite(update.steps) || !Number.isInteger(update.steps) || update.steps < 0) {
              recordDiagnostic('gps-steps-invalid', 'counter');
              return;
            }
            const previousRaw = previousRawSteps;
            const delta = previousRaw === undefined ? 0 : update.steps - previousRaw;
            previousRawSteps = update.steps;
            if (stepBaseline === undefined) stepBaseline = update.steps;
            if (previousRaw !== undefined && delta < 0) {
              // A sensor reset must start a fresh baseline and epoch; never
              // turn the post-reset cumulative value into backfilled steps.
              stepBaseline = update.steps;
              stepCounter = 0;
              sensorEpoch = newSensorEpoch();
            } else {
              // The payload is cumulative from this sensor baseline. The
              // callback-to-callback delta is diagnostic-only.
              stepCounter = update.steps - stepBaseline;
            }
            stepEvents += 1;
            recordDiagnostic('gps-steps', `${stepCounter}:${delta}`);
            setResult(previous => ({ ...previous, detectedSteps: stepCounter, stepEvents }));
            // A step event must never make a stale coordinate look current.
            emit();
          });
          if (disposed || generation !== startGeneration || !active) {
            nextStepSubscription.remove();
            return;
          }
          stepSubscription = nextStepSubscription;
        }
        } catch (error) {
          recordDiagnostic('gps-error', errorStatus(error));
          if (!disposed && generation === startGeneration) {
            setTrackerStatus(errorStatus(error), false);
          }
        }
      })();
      startupPromise = promise;
      void promise.then(() => {
        if (startupPromise === promise) startupPromise = undefined;
        if (!disposed && enabled && active && generation !== startGeneration) void startForeground();
      }, () => {
        if (startupPromise === promise) startupPromise = undefined;
      });
      return promise;
    };

    refreshRef.current = () => {
      if (refreshPromise) return refreshPromise;
      refreshPromise = (async () => {
        if (disposed || !enabled || !active) throw new Error('위치 추적을 사용할 수 없어요');
        if (startupPromise) await startupPromise;
        if (disposed || !enabled || !active) throw new Error('위치 추적이 중지되었어요');
        if (!locationPermissionReady || !locationSubscription) throw new Error('위치 추적이 아직 준비되지 않았어요');
        const generation = startGeneration;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const location = await Promise.race([
            Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation }),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new Error('현재 위치를 확인하는 데 시간이 걸려요')), REFRESH_TIMEOUT_MS);
            }),
          ]);
          if (disposed || !active || generation !== startGeneration) throw new Error('위치 추적이 중지되었어요');
          lastLocation = location;
          const sample = validSample(location, stepCounter, sensorEpoch);
          callbackRef.current(sample);
          return sample;
        } catch (error) {
          recordDiagnostic('gps-refresh-error', error instanceof Error ? error.message : 'refresh');
          throw error instanceof Error ? error : new Error('현재 위치를 확인하지 못했어요');
        } finally {
          if (timer) clearTimeout(timer);
        }
      })();
      void refreshPromise.then(() => { refreshPromise = undefined; }, () => { refreshPromise = undefined; });
      return refreshPromise;
    };

    const onAppStateChange = (nextState: AppStateStatus) => {
      recordDiagnostic('gps-appstate', nextState);
      // iOS permission sheets may be inactive, but a real background transition
      // must always stop tracking (including Home pressed during a permission prompt).
      if (permissionPromptInFlight && nextState === 'inactive') return;
      const wasActive = active;
      active = nextState === 'active';
      if (active && !wasActive) {
        void startForeground();
      } else if (!active && wasActive) {
        ++startGeneration;
        clearSubscriptions();
        recordDiagnostic('gps-stop', 'background');
        if (enabled) setTrackerStatus('백그라운드에서 위치 추적을 중지했어요', false);
      }
    };

    appStateSubscription = AppState.addEventListener('change', onAppStateChange);
    if (enabled && active) void startForeground();
    else if (!enabled) setTrackerStatus('위치 추적 꺼짐', false);

    return () => {
      disposed = true;
      ++startGeneration;
      clearSubscriptions();
      recordDiagnostic('gps-stop', 'unmount');
      appStateSubscription?.remove();
    };
  }, [enabled, sessionKey]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { ...result, refresh };
}
