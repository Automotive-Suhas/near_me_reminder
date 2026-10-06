import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'near-me-reminder.reminders.v1';

export type Reminder = {
  id: string;
  title: string;
  placeName: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  createdAt: string;
  active: boolean;
  triggeredAt: string | null;
  activeFrom: string;
  activeTo: string;
};

type LegacyReminder = Omit<Reminder, 'active' | 'triggeredAt' | 'activeFrom' | 'activeTo'> & {
  active?: boolean;
  triggeredAt?: string | null;
  activeFrom?: string;
  activeTo?: string;
};

function normalizeReminder(value: unknown): Reminder | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<LegacyReminder>;
  const valid =
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.placeName === 'string' &&
    typeof item.latitude === 'number' &&
    Number.isFinite(item.latitude) &&
    typeof item.longitude === 'number' &&
    Number.isFinite(item.longitude) &&
    typeof item.radiusMeters === 'number' &&
    Number.isFinite(item.radiusMeters) &&
    typeof item.createdAt === 'string' &&
    (item.triggeredAt === undefined ||
      item.triggeredAt === null ||
      typeof item.triggeredAt === 'string') &&
    (item.active === undefined || typeof item.active === 'boolean');

  if (!valid) return null;
  const triggeredAt = item.triggeredAt ?? null;
  return {
    id: item.id!,
    title: item.title!,
    placeName: item.placeName!,
    latitude: item.latitude!,
    longitude: item.longitude!,
    radiusMeters: item.radiusMeters!,
    createdAt: item.createdAt!,
    active: item.active ?? !triggeredAt,
    triggeredAt,
    activeFrom: item.activeFrom ?? '00:00',
    activeTo: item.activeTo ?? '23:59',
  };
}

async function readAll(): Promise<Reminder[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Saved reminders are not in the expected format.');
    }
    const reminders = parsed.map(normalizeReminder);
    if (reminders.some((reminder) => reminder === null)) {
      throw new Error('Saved reminders are not in the expected format.');
    }
    const normalized = reminders as Reminder[];
    if (
      normalized.some(
        (reminder) =>
          reminder.latitude < -90 ||
          reminder.latitude > 90 ||
          reminder.longitude < -180 ||
          reminder.longitude > 180 ||
          reminder.radiusMeters < 100,
      )
    ) {
      throw new Error('A saved reminder contains invalid coordinates or radius.');
    }
    return normalized;
  } catch (error) {
    throw new Error(
      `Could not read saved reminders: ${
        error instanceof Error ? error.message : 'invalid stored data'
      }`,
    );
  }
}

async function writeAll(reminders: Reminder[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reminders));
}

let writeQueue: Promise<void> = Promise.resolve();

function serializeWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(write, write);
  writeQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export async function getReminders(): Promise<Reminder[]> {
  const reminders = await readAll();
  return reminders.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getReminder(id: string): Promise<Reminder | null> {
  return (await readAll()).find((reminder) => reminder.id === id) ?? null;
}

export async function addReminder(
  reminder: Omit<Reminder, 'id' | 'createdAt' | 'active' | 'triggeredAt'>,
): Promise<Reminder> {
  return serializeWrite(async () => {
    const created: Reminder = {
      ...reminder,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      createdAt: new Date().toISOString(),
      active: true,
      triggeredAt: null,
      activeFrom: reminder.activeFrom,
      activeTo: reminder.activeTo,
    };
    const reminders = await readAll();
    await writeAll([created, ...reminders]);
    return created;
  });
}

export async function updateReminder(
  id: string,
  changes: Partial<Omit<Reminder, 'id' | 'createdAt'>>,
): Promise<Reminder | null> {
  return serializeWrite(async () => {
    const reminders = await readAll();
    const index = reminders.findIndex((reminder) => reminder.id === id);
    if (index < 0) return null;

    const updated: Reminder = {
      ...reminders[index],
      ...changes,
    };
    reminders[index] = updated;
    await writeAll(reminders);
    return updated;
  });
}

export function isReminderWithinActiveWindow(
  reminder: Pick<Reminder, 'activeFrom' | 'activeTo'>,
  now = new Date(),
): boolean {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const parse = (value: string) => {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;
    return hours * 60 + minutes;
  };

  const from = parse(reminder.activeFrom);
  const to = parse(reminder.activeTo);
  if (from == null || to == null) return true;
  if (from < to) return currentMinutes >= from && currentMinutes <= to;
  if (from > to) return currentMinutes >= from || currentMinutes <= to;
  return true;
}

export async function claimReminderTrigger(
  id: string,
  triggeredAt = new Date().toISOString(),
): Promise<Reminder | null> {
  return serializeWrite(async () => {
    const reminders = await readAll();
    const index = reminders.findIndex((reminder) => reminder.id === id);
    if (index < 0 || !reminders[index].active || reminders[index].triggeredAt) {
      return null;
    }

    const claimed = {
      ...reminders[index],
      active: false,
      triggeredAt,
    };
    reminders[index] = claimed;
    await writeAll(reminders);
    return claimed;
  });
}

export async function removeReminder(id: string): Promise<void> {
  await serializeWrite(async () => {
    const reminders = await readAll();
    await writeAll(reminders.filter((reminder) => reminder.id !== id));
  });
}