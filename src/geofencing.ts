import { Alert, Platform } from 'react-native';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import {
  claimReminderTrigger,
  getReminder,
  getReminders,
  type Reminder,
} from '@/src/reminderStore';
import {
  recordGeofenceEvent,
  recordNotificationResult,
} from '@/src/debugStore';

export const GEOFENCE_TASK = 'near-me-reminder.geofence-enter.v1';
export const NOTIFICATION_CHANNEL = 'nearby-reminders';

const GEOFENCE_ID_PREFIX = 'near-me-reminder:';

type GeofenceEvent = {
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
};

export type PermissionIssue =
  | 'foreground'
  | 'background'
  | 'notifications'
  | 'location-services'
  | 'unavailable';

export class PermissionSetupError extends Error {
  constructor(
    message: string,
    readonly permission: PermissionIssue,
  ) {
    super(message);
    this.name = 'PermissionSetupError';
  }
}

function geofenceIdentifier(reminderId: string): string {
  return `${GEOFENCE_ID_PREFIX}${reminderId}`;
}

function reminderIdFromGeofence(identifier: string | null): string | null {
  if (!identifier?.startsWith(GEOFENCE_ID_PREFIX)) return null;
  return identifier.slice(GEOFENCE_ID_PREFIX.length);
}

function explainBeforeRequest(
  title: string,
  message: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (accepted: boolean) => {
      if (resolved) return;
      resolved = true;
      resolve(accepted);
    };

    Alert.alert(
      title,
      message,
      [
        {
          text: 'Not now',
          style: 'cancel',
          onPress: () => finish(false),
        },
        {
          text: 'Continue',
          onPress: () => finish(true),
        },
      ],
      { cancelable: true, onDismiss: () => finish(false) },
    );
  });
}

export async function ensureLocationServicesEnabled(): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new PermissionSetupError(
      'Background geofence monitoring is available in the Android app build.',
      'unavailable',
    );
  }

  if (!(await Location.hasServicesEnabledAsync())) {
    throw new PermissionSetupError(
      'Device Location is turned off. Enable Location in Android Quick Settings or open Android Settings > Location, then try again.',
      'location-services',
    );
  }
}

async function ensureForegroundLocationPermission(): Promise<void> {
  let permission = await Location.getForegroundPermissionsAsync();
  if (permission.granted) return;

  if (!permission.canAskAgain) {
    throw new PermissionSetupError(
      'Foreground location is blocked. Open Android app settings, allow Location while using the app, then try again.',
      'foreground',
    );
  }

  const accepted = await explainBeforeRequest(
    'Allow location while using NearMe?',
    'NearMe needs foreground location to fill in your current coordinates and to set up a location reminder.',
  );
  if (!accepted) {
    throw new PermissionSetupError(
      'Foreground location is needed to set up a location reminder.',
      'foreground',
    );
  }

  permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new PermissionSetupError(
      'Allow Location while using the app in Android settings to use current coordinates and set up geofences.',
      'foreground',
    );
  }
}

async function ensureBackgroundLocationPermission(): Promise<void> {
  let permission = await Location.getBackgroundPermissionsAsync();
  if (permission.granted) return;

  if (!permission.canAskAgain) {
    throw new PermissionSetupError(
      'Background location is blocked. Open Android app settings > Permissions > Location and choose “Allow all the time”.',
      'background',
    );
  }

  const accepted = await explainBeforeRequest(
    'Allow background location?',
    'Android needs “Allow all the time” location access to deliver geofence events while NearMe is closed or another app is open. NearMe registers saved circular areas; it does not poll GPS continuously.',
  );
  if (!accepted) {
    throw new PermissionSetupError(
      'Background location is required for reminders to trigger while the app is closed. In Android app settings > Permissions > Location, choose “Allow all the time”.',
      'background',
    );
  }

  permission = await Location.requestBackgroundPermissionsAsync();
  if (!permission.granted) {
    throw new PermissionSetupError(
      'Background location was not allowed. Open Android app settings > Permissions > Location and choose “Allow all the time”, then return to NearMe.',
      'background',
    );
  }
}

export async function requestForegroundLocationPermission(): Promise<void> {
  await ensureLocationServicesEnabled();
  await ensureForegroundLocationPermission();
}

async function ensureNotificationPermission(): Promise<void> {
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL, {
    name: 'Nearby reminders',
    description: 'Alerts when you enter a saved reminder location.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    enableVibrate: true,
    showBadge: true,
  });

  let permission = await Notifications.getPermissionsAsync();
  if (permission.granted) return;

  if (!permission.canAskAgain) {
    throw new PermissionSetupError(
      'Notifications are blocked. Open Android app settings > Notifications and allow NearMe Reminder notifications.',
      'notifications',
    );
  }

  const accepted = await explainBeforeRequest(
    'Allow reminder notifications?',
    'NearMe needs notification permission to show your reminder when Android reports that you entered a saved area.',
  );
  if (!accepted) {
    throw new PermissionSetupError(
      'Notification permission is required to alert you when you arrive.',
      'notifications',
    );
  }

  permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) {
    throw new PermissionSetupError(
      'Notifications were not allowed. Open Android app settings > Notifications and allow NearMe Reminder.',
      'notifications',
    );
  }
}

export async function requestMonitoringPermissions(): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new PermissionSetupError(
      'Geofence monitoring is available in the Android app build.',
      'unavailable',
    );
  }

  await ensureLocationServicesEnabled();
  await ensureForegroundLocationPermission();
  await ensureBackgroundLocationPermission();
  await ensureNotificationPermission();
  await ensureLocationServicesEnabled();
}

function toRegion(reminder: Reminder): Location.LocationRegion {
  return {
    identifier: geofenceIdentifier(reminder.id),
    latitude: reminder.latitude,
    longitude: reminder.longitude,
    radius: reminder.radiusMeters,
    notifyOnEnter: true,
    notifyOnExit: true,
  };
}

async function getRegisteredRegions(): Promise<Location.LocationRegion[]> {
  const tasks = await TaskManager.getRegisteredTasksAsync();
  const task = tasks.find((entry) => entry.taskName === GEOFENCE_TASK);
  const options = task?.options as
    | { regions?: Location.LocationRegion[] }
    | undefined;
  return Array.isArray(options?.regions) ? options.regions : [];
}

export class GeofenceManager {
  async registerGeofence(reminderId: string): Promise<boolean> {
    const reminder = await getReminder(reminderId);
    if (!reminder || !reminder.active || reminder.triggeredAt) {
      throw new Error('Only a saved, active reminder can be registered.');
    }
    return this.synchronizeActiveReminders();
  }

  async unregisterGeofence(reminderId: string): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (!(await Location.hasStartedGeofencingAsync(GEOFENCE_TASK))) return;

    const target = geofenceIdentifier(reminderId);
    const remaining = (await getRegisteredRegions()).filter(
      (region) => region.identifier !== target,
    );
    if (remaining.length === 0) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
      return;
    }
    await Location.startGeofencingAsync(GEOFENCE_TASK, remaining);
  }

  async unregisterAllGeofences(): Promise<void> {
    if (Platform.OS !== 'android') return;
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
    }
  }

  async synchronizeActiveReminders(): Promise<boolean> {
    if (Platform.OS !== 'android') return false;
    if (!(await TaskManager.isAvailableAsync())) return false;

    const active = (await getReminders()).filter(
      (reminder) => reminder.active && !reminder.triggeredAt,
    );
    if (active.length > 100) {
      throw new Error('Android supports up to 100 active geofences at a time.');
    }

    if (active.length === 0) {
      await this.unregisterAllGeofences();
      return true;
    }

    const permission = await Location.getBackgroundPermissionsAsync();
    if (!permission.granted) return false;
    if (!(await Location.hasServicesEnabledAsync())) return false;

    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      active.map(toRegion),
    );
    return true;
  }

  async getRegisteredGeofenceIds(): Promise<string[]> {
    if (Platform.OS !== 'android') return [];
    if (!(await TaskManager.isAvailableAsync())) return [];
    const regions = await getRegisteredRegions();
    return regions
      .map((region) => region.identifier)
      .filter((identifier): identifier is string => Boolean(identifier))
      .sort();
  }
}

export const geofenceManager = new GeofenceManager();

async function sendReminderNotification(reminder: Reminder): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: '📍 NearMe Reminder',
      body: reminder.title,
      sound: 'default',
      data: { reminderId: reminder.id },
    },
    trigger: { channelId: NOTIFICATION_CHANNEL },
  });
}

async function handleGeofenceEvent(
  data: GeofenceEvent | null,
  taskError: { message: string } | null,
): Promise<void> {
  if (taskError) {
    await recordGeofenceEvent({
      eventType: 'ERROR',
      geofenceId: null,
      reminderId: null,
      at: new Date().toISOString(),
      message: taskError.message,
    });
    return;
  }
  if (!data) return;

  const geofenceId = data.region?.identifier ?? null;
  const reminderId = reminderIdFromGeofence(geofenceId);
  const isEnter = data.eventType === Location.GeofencingEventType.Enter;
  const isExit = data.eventType === Location.GeofencingEventType.Exit;

  await recordGeofenceEvent({
    eventType: isEnter ? 'ENTER' : isExit ? 'EXIT' : 'ERROR',
    geofenceId,
    reminderId,
    at: new Date().toISOString(),
    ...(!isEnter && !isExit
      ? { message: `Unrecognized geofence event type: ${data.eventType}` }
      : {}),
  });

  if (!isEnter || !reminderId) return;

  const reminder = await getReminder(reminderId);
  if (!reminder || !reminder.active || reminder.triggeredAt) return;

  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    await recordNotificationResult(reminder.id, {
      error: 'Notification permission was unavailable when the geofence event arrived.',
    });
    return;
  }

  const claimed = await claimReminderTrigger(reminder.id);
  if (!claimed) return;

  try {
    await sendReminderNotification(claimed);
    await recordNotificationResult(reminder.id, {
      sentAt: claimed.triggeredAt ?? new Date().toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Notification scheduling failed.';
    await recordNotificationResult(reminder.id, { error: message });
    throw error;
  } finally {
    await geofenceManager.synchronizeActiveReminders();
  }
}

if (Platform.OS === 'android' && !TaskManager.isTaskDefined(GEOFENCE_TASK)) {
  TaskManager.defineTask<GeofenceEvent>(
    GEOFENCE_TASK,
    async ({ data, error }) => {
      await handleGeofenceEvent(data ?? null, error ?? null);
    },
  );
}