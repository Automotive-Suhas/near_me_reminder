import AsyncStorage from '@react-native-async-storage/async-storage';

const DEBUG_STORAGE_KEY = 'near-me-reminder.debug.v1';

export type GeofenceEventRecord = {
  eventType: 'ENTER' | 'EXIT' | 'ERROR';
  geofenceId: string | null;
  reminderId: string | null;
  at: string;
  message?: string;
};

export type DebugRecord = {
  lastGeofenceEvent: GeofenceEventRecord | null;
  lastNotificationAt: string | null;
  lastNotificationReminderId: string | null;
  lastNotificationError: string | null;
};

const EMPTY_DEBUG_RECORD: DebugRecord = {
  lastGeofenceEvent: null,
  lastNotificationAt: null,
  lastNotificationReminderId: null,
  lastNotificationError: null,
};

export async function getDebugRecord(): Promise<DebugRecord> {
  const raw = await AsyncStorage.getItem(DEBUG_STORAGE_KEY);
  if (!raw) return EMPTY_DEBUG_RECORD;
  try {
    const parsed: Partial<DebugRecord> = JSON.parse(raw);
    return {
      lastGeofenceEvent: parsed.lastGeofenceEvent ?? null,
      lastNotificationAt: parsed.lastNotificationAt ?? null,
      lastNotificationReminderId: parsed.lastNotificationReminderId ?? null,
      lastNotificationError: parsed.lastNotificationError ?? null,
    };
  } catch {
    throw new Error('Saved geofence debug information could not be read.');
  }
}

async function saveDebugRecord(update: Partial<DebugRecord>): Promise<void> {
  const current = await getDebugRecord();
  await AsyncStorage.setItem(
    DEBUG_STORAGE_KEY,
    JSON.stringify({ ...current, ...update }),
  );
}

export async function recordGeofenceEvent(
  event: GeofenceEventRecord,
): Promise<void> {
  await saveDebugRecord({ lastGeofenceEvent: event });
}

export async function recordNotificationResult(
  reminderId: string,
  result: { sentAt: string } | { error: string },
): Promise<void> {
  if ('sentAt' in result) {
    await saveDebugRecord({
      lastNotificationAt: result.sentAt,
      lastNotificationReminderId: reminderId,
      lastNotificationError: null,
    });
    return;
  }
  await saveDebugRecord({ lastNotificationError: result.error });
}