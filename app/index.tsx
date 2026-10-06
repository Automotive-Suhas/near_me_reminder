import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { getReminders, removeReminder, type Reminder } from '@/src/reminderStore';
import { getDebugRecord, type GeofenceEventRecord } from '@/src/debugStore';
import { geofenceManager } from '@/src/geofencing';

type DeveloperSnapshot = {
  androidBuildOnly: boolean;
  locationServices: string;
  currentLocation: string;
  foregroundPermission: string;
  backgroundPermission: string;
  notificationPermission: string;
  activeReminders: number;
  registeredGeofenceIds: string[];
  lastGeofenceEvent: GeofenceEventRecord | null;
  lastNotificationAt: string | null;
  lastNotificationError: string | null;
};

function permissionLabel(permission: {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
}): string {
  if (permission.granted) return 'Granted';
  return permission.canAskAgain
    ? `${permission.status} — not granted`
    : `${permission.status} — change in Android app settings`;
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [monitoringReady, setMonitoringReady] = useState(false);
  const [locationServicesEnabled, setLocationServicesEnabled] = useState<
    boolean | null
  >(null);
  const [loadError, setLoadError] = useState('');
  const [developerInfoExpanded, setDeveloperInfoExpanded] = useState(false);
  const [developerInfoLoading, setDeveloperInfoLoading] = useState(false);
  const [developerInfoError, setDeveloperInfoError] = useState('');
  const [developerSnapshot, setDeveloperSnapshot] =
    useState<DeveloperSnapshot | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const saved = await getReminders();
      const servicesEnabled =
        Platform.OS === 'android'
          ? await Location.hasServicesEnabledAsync()
          : null;
      const ready = await geofenceManager.synchronizeActiveReminders();
      setReminders(saved);
      setMonitoringReady(ready);
      setLocationServicesEnabled(servicesEnabled);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Could not load reminders.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshDeveloperInfo = useCallback(async () => {
    setDeveloperInfoLoading(true);
    setDeveloperInfoError('');
    if (Platform.OS !== 'android') {
      setDeveloperSnapshot({
        androidBuildOnly: true,
        locationServices: 'Android development build required',
        currentLocation: 'Available only on an Android development build',
        foregroundPermission: 'Android development build required',
        backgroundPermission: 'Android development build required',
        notificationPermission: 'Android development build required',
        activeReminders: reminders.filter(
          (reminder) => reminder.active && !reminder.triggeredAt,
        ).length,
        registeredGeofenceIds: [],
        lastGeofenceEvent: null,
        lastNotificationAt: null,
        lastNotificationError: null,
      });
      setDeveloperInfoLoading(false);
      return;
    }

    try {
      const [
        servicesEnabled,
        foreground,
        background,
        notification,
        savedReminders,
        registeredGeofenceIds,
        debugRecord,
      ] = await Promise.all([
        Location.hasServicesEnabledAsync(),
        Location.getForegroundPermissionsAsync(),
        Location.getBackgroundPermissionsAsync(),
        Notifications.getPermissionsAsync(),
        getReminders(),
        geofenceManager.getRegisteredGeofenceIds(),
        getDebugRecord(),
      ]);

      let currentLocation = 'Unavailable';
      if (!servicesEnabled) {
        currentLocation = 'Unavailable — device Location is turned off';
      } else if (!foreground.granted) {
        currentLocation = 'Unavailable — foreground location is not granted';
      } else {
        try {
          const position = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          currentLocation = `${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}${
            position.coords.accuracy == null
              ? ''
              : ` (±${Math.round(position.coords.accuracy)} m)`
          }`;
        } catch (error) {
          currentLocation =
            error instanceof Error
              ? `Unavailable — ${error.message}`
              : 'Unavailable — could not read a location fix';
        }
      }

      setDeveloperSnapshot({
        androidBuildOnly: false,
        locationServices: servicesEnabled ? 'On' : 'Off',
        currentLocation,
        foregroundPermission: permissionLabel(foreground),
        backgroundPermission: permissionLabel(background),
        notificationPermission: permissionLabel(notification),
        activeReminders: savedReminders.filter(
          (reminder) => reminder.active && !reminder.triggeredAt,
        ).length,
        registeredGeofenceIds,
        lastGeofenceEvent: debugRecord.lastGeofenceEvent,
        lastNotificationAt: debugRecord.lastNotificationAt,
        lastNotificationError: debugRecord.lastNotificationError,
      });
    } catch (error) {
      setDeveloperInfoError(
        error instanceof Error
          ? error.message
          : 'Could not read Android developer information.',
      );
    } finally {
      setDeveloperInfoLoading(false);
    }
  }, [reminders]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const askToRemove = (reminder: Reminder) => {
    Alert.alert(
      'Remove this reminder?',
      `“${reminder.title}” will no longer trigger at ${reminder.placeName}.`,
      [
        { text: 'Keep reminder', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await removeReminder(reminder.id);
                await geofenceManager.unregisterGeofence(reminder.id);
                await geofenceManager.synchronizeActiveReminders();
                await refresh();
              } catch (error) {
                Alert.alert(
                  'Could not remove reminder',
                  error instanceof Error ? error.message : 'Try again.',
                );
              }
            })();
          },
        },
      ],
    );
  };

  const activeCount = reminders.filter(
    (item) => item.active && !item.triggeredAt,
  ).length;
  const webTop = Platform.OS === 'web' ? 67 : 18;
  const webBottom = Platform.OS === 'web' ? 34 : 20;

  return (
    <View
      style={[
        styles.screen,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + webTop,
          paddingBottom: insets.bottom + webBottom,
        },
      ]}
    >
      <View style={styles.header}>
        <View>
          <View style={styles.brandLine}>
            <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
              <Feather name="map-pin" size={15} color={colors.primaryForeground} />
            </View>
            <Text style={[styles.brand, { color: colors.foreground }]}>
              NearMe
            </Text>
          </View>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
            PERSONAL REMINDERS
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create reminder"
          testID="create-reminder"
          onPress={() => router.push('/create-reminder')}
          style={({ pressed }) => [
            styles.addButton,
            { backgroundColor: colors.primary, opacity: pressed ? 0.82 : 1 },
          ]}
        >
          <Feather name="plus" size={21} color={colors.primaryForeground} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.contentScroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { backgroundColor: '#183B34' }]}>
          <View style={styles.heroTop}>
            <View style={styles.liveDot} />
            <Text style={styles.heroKicker}>REMEMBER AT THE RIGHT PLACE</Text>
          </View>
          <Text style={styles.heroTitle}>The right reminder,{'\n'}right on time.</Text>
          <Text style={styles.heroDescription}>
            A quiet nudge when you arrive. No constant GPS tracking.
          </Text>
          <View style={styles.heroBottom}>
            <Feather name="radio" size={16} color="#E9A28B" />
            <Text style={styles.heroFootnote}>
              {activeCount} {activeCount === 1 ? 'place' : 'places'} to remember
            </Text>
          </View>
        </View>

        {Platform.OS === 'web' ? (
          <View style={[styles.notice, { backgroundColor: colors.accent }]}>
            <Feather name="smartphone" size={17} color={colors.accentForeground} />
            <Text style={[styles.noticeText, { color: colors.accentForeground }]}>
              Browser preview checks the interface only. Background geofencing must be tested in a native Android development build.
            </Text>
          </View>
        ) : activeCount > 0 &&
          (!monitoringReady || locationServicesEnabled === false) ? (
          <View style={[styles.notice, { backgroundColor: colors.accent }]}>
            <Feather name="alert-circle" size={17} color={colors.accentForeground} />
            <View style={styles.noticeContent}>
              <Text style={[styles.noticeText, { color: colors.accentForeground }]}>
                {locationServicesEnabled === false
                  ? 'Device Location is off. Turn it on in Android Quick Settings or Settings > Location.'
                  : 'Geofence monitoring is not ready. Check background Location and notification permissions in Android app settings.'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void Linking.openSettings()}
                style={styles.settingsAction}
              >
                <Text style={[styles.settingsActionText, { color: colors.accentForeground }]}>
                  Open app settings
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
              Your places
            </Text>
            <Text style={[styles.sectionSubtitle, { color: colors.mutedForeground }]}>
              One alert the first time you arrive
            </Text>
          </View>
          {activeCount > 0 && (
            <View style={[styles.countPill, { backgroundColor: colors.secondary }]}>
              <Text style={[styles.countText, { color: colors.secondaryForeground }]}>
                {activeCount} active
              </Text>
            </View>
          )}
        </View>

        {loading ? (
          <View style={styles.centerState}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : loadError ? (
          <View style={styles.stateCard}>
            <Text style={[styles.stateTitle, { color: colors.foreground }]}>
              Reminders couldn’t load
            </Text>
            <Text style={[styles.stateBody, { color: colors.mutedForeground }]}>
              {loadError}
            </Text>
            <Pressable onPress={() => void refresh()}>
              <Text style={[styles.retryText, { color: colors.primary }]}>Try again</Text>
            </Pressable>
          </View>
        ) : reminders.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: colors.card }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.secondary }]}>
              <Feather name="map" size={23} color={colors.secondaryForeground} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              Nothing to remember yet
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Add a place and we’ll let you know when you get there.
            </Text>
            <Pressable
              onPress={() => router.push('/create-reminder')}
              style={({ pressed }) => [
                styles.emptyAction,
                { backgroundColor: colors.foreground, opacity: pressed ? 0.84 : 1 },
              ]}
            >
              <Text style={[styles.emptyActionText, { color: colors.background }]}>
                Create a reminder
              </Text>
              <Feather name="arrow-up-right" size={16} color={colors.background} />
            </Pressable>
          </View>
        ) : (
          <View style={styles.listContent}>
            {reminders.map((item) => (
              <ReminderCard
                key={item.id}
                reminder={item}
                onRemove={() => askToRemove(item)}
                onEdit={() => router.push({ pathname: '/create-reminder', params: { id: item.id } })}
                colors={colors}
              />
            ))}
          </View>
        )}

        <View style={styles.developerSection}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: developerInfoExpanded }}
            testID="developer-test-information"
            onPress={() => {
              const expanded = !developerInfoExpanded;
              setDeveloperInfoExpanded(expanded);
              if (expanded) void refreshDeveloperInfo();
            }}
            style={[
              styles.developerToggle,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.developerTitleGroup}>
              <Text style={[styles.developerTitle, { color: colors.foreground }]}>
                Developer/Test Information
              </Text>
              <Text style={[styles.developerSubtitle, { color: colors.mutedForeground }]}>
                Permissions, geofence state, and latest event
              </Text>
            </View>
            <Feather
              name={developerInfoExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.mutedForeground}
            />
          </Pressable>

          {developerInfoExpanded && (
            <View style={[styles.developerCard, { backgroundColor: colors.card }]}>
              <View style={styles.developerActions}>
                <Text style={[styles.developerCardTitle, { color: colors.foreground }]}>
                  Device status
                </Text>
                <Pressable
                  accessibilityRole="button"
                  testID="refresh-developer-information"
                  disabled={developerInfoLoading}
                  onPress={() => void refreshDeveloperInfo()}
                >
                  <Text style={[styles.retryText, { color: colors.primary }]}>
                    {developerInfoLoading ? 'Refreshing…' : 'Refresh'}
                  </Text>
                </Pressable>
              </View>

              {developerInfoLoading && !developerSnapshot ? (
                <ActivityIndicator color={colors.primary} />
              ) : developerInfoError ? (
                <Text style={[styles.debugError, { color: colors.destructive }]}>
                  {developerInfoError}
                </Text>
              ) : developerSnapshot ? (
                <>
                  <DiagnosticRow label="Current location" value={developerSnapshot.currentLocation} colors={colors} />
                  <DiagnosticRow label="Location services" value={developerSnapshot.locationServices} colors={colors} />
                  <DiagnosticRow label="Foreground location" value={developerSnapshot.foregroundPermission} colors={colors} />
                  <DiagnosticRow label="Background location" value={developerSnapshot.backgroundPermission} colors={colors} />
                  <DiagnosticRow label="Notifications" value={developerSnapshot.notificationPermission} colors={colors} />
                  <DiagnosticRow label="Active reminders" value={String(developerSnapshot.activeReminders)} colors={colors} />
                  <DiagnosticRow
                    label="Registered geofence IDs"
                    value={
                      developerSnapshot.androidBuildOnly
                        ? 'Android development build required'
                        : developerSnapshot.registeredGeofenceIds.length
                          ? developerSnapshot.registeredGeofenceIds.join('\n')
                          : 'None'
                    }
                    colors={colors}
                  />
                  <DiagnosticRow
                    label="Last geofence event"
                    value={
                      developerSnapshot.lastGeofenceEvent
                        ? `${developerSnapshot.lastGeofenceEvent.eventType} · ${new Date(developerSnapshot.lastGeofenceEvent.at).toLocaleString()}${developerSnapshot.lastGeofenceEvent.geofenceId ? `\n${developerSnapshot.lastGeofenceEvent.geofenceId}` : ''}${developerSnapshot.lastGeofenceEvent.message ? `\n${developerSnapshot.lastGeofenceEvent.message}` : ''}`
                        : 'None recorded'
                    }
                    colors={colors}
                  />
                  <DiagnosticRow
                    label="Last notification time"
                    value={
                      developerSnapshot.lastNotificationAt
                        ? new Date(developerSnapshot.lastNotificationAt).toLocaleString()
                        : 'None recorded'
                    }
                    colors={colors}
                  />
                  {developerSnapshot.lastNotificationError ? (
                    <DiagnosticRow
                      label="Last notification error"
                      value={developerSnapshot.lastNotificationError}
                      colors={colors}
                    />
                  ) : null}
                  <Text style={[styles.debugFootnote, { color: colors.mutedForeground }]}>
                    Geofence IDs show Expo Task Manager registration options. They do not prove that Android delivered an event.
                  </Text>
                </>
              ) : (
                <Text style={[styles.debugFootnote, { color: colors.mutedForeground }]}>
                  Refresh to read device status. This does not request permissions.
                </Text>
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function DiagnosticRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.diagnosticRow, { borderBottomColor: colors.border }]}>
      <Text style={[styles.diagnosticLabel, { color: colors.mutedForeground }]}>
        {label}
      </Text>
      <Text selectable style={[styles.diagnosticValue, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

function ReminderCard({
  reminder,
  onRemove,
  onEdit,
  colors,
}: {
  reminder: Reminder;
  onRemove: () => void;
  onEdit: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const triggered = Boolean(reminder.triggeredAt);
  return (
    <View style={[styles.reminderCard, { backgroundColor: colors.card }]}>
      <View style={[styles.cardIcon, { backgroundColor: colors.accent }]}>
        <Feather
          name={triggered ? 'check' : 'map-pin'}
          size={18}
          color={colors.accentForeground}
        />
      </View>
      <View style={styles.cardContent}>
        <View style={styles.cardTitleRow}>
          <View style={styles.cardTitleGroup}>
            <Text style={[styles.reminderTitle, { color: colors.foreground }]}>
              {reminder.title}
            </Text>
            <Text style={[styles.placeName, { color: colors.mutedForeground }]}>
              {reminder.placeName}
            </Text>
          </View>
          <View style={styles.cardActions}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${reminder.title}`} onPress={onEdit} hitSlop={10} style={styles.removeButton}>
              <Feather name="edit-2" size={15} color={colors.mutedForeground} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${reminder.title}`} onPress={onRemove} hitSlop={10} style={styles.removeButton}>
              <Feather name="trash-2" size={16} color={colors.mutedForeground} />
            </Pressable>
          </View>
        </View>
        <View style={styles.cardMetaRow}>
          <View style={[styles.metaPill, { backgroundColor: colors.secondary }]}>
            <Feather name="crosshair" size={12} color={colors.secondaryForeground} />
            <Text style={[styles.metaText, { color: colors.secondaryForeground }]}>
              {reminder.radiusMeters} m
            </Text>
          </View>
          <Text style={[styles.cardStatus, { color: triggered ? colors.primary : colors.mutedForeground }]}>
            {triggered ? 'Alert sent' : `${reminder.activeFrom}–${reminder.activeTo}`}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 22 },
  header: {
    minHeight: 48,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 22,
  },
  brandLine: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandMark: {
    width: 26,
    height: 26,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { fontFamily: 'Inter_700Bold', fontSize: 19, letterSpacing: -0.5 },
  eyebrow: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.8, marginTop: 6 },
  addButton: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentScroll: { flex: 1 },
  scrollContent: { paddingBottom: 16 },
  hero: { borderRadius: 25, padding: 22, marginBottom: 20, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#E9A28B' },
  heroKicker: { color: '#C2D1C5', fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.5 },
  heroTitle: { color: '#FAF6EF', fontFamily: 'Inter_700Bold', fontSize: 26, lineHeight: 31, letterSpacing: -0.8, marginTop: 18 },
  heroDescription: { color: '#C2D1C5', fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19, marginTop: 9, maxWidth: 270 },
  heroBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 19 },
  heroFootnote: { color: '#F1C0AB', fontFamily: 'Inter_500Medium', fontSize: 11 },
  notice: { borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  noticeText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 11, lineHeight: 16 },
  noticeContent: { flex: 1 },
  settingsAction: { alignSelf: 'flex-start', marginTop: 6, paddingVertical: 3 },
  settingsActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.4 },
  sectionSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 4 },
  countPill: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 6 },
  countText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  centerState: { minHeight: 130, justifyContent: 'center' },
  stateCard: { borderRadius: 20, padding: 19, backgroundColor: '#FFFFFF' },
  stateTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  stateBody: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 7 },
  retryText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, marginTop: 14 },
  emptyCard: { padding: 20, borderRadius: 22, alignItems: 'flex-start' },
  emptyIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16, letterSpacing: -0.3 },
  emptyBody: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 7, maxWidth: 260 },
  emptyAction: { minHeight: 42, borderRadius: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  emptyActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  listContent: { gap: 10, paddingBottom: 12 },
  developerSection: { marginTop: 13 },
  developerToggle: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: 17,
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  developerTitleGroup: { flex: 1 },
  developerTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  developerSubtitle: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 4 },
  developerCard: { borderRadius: 17, padding: 14, marginTop: 8 },
  developerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  developerCardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  debugError: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16 },
  diagnosticRow: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  diagnosticLabel: { fontFamily: 'Inter_500Medium', fontSize: 9, letterSpacing: 0.2 },
  diagnosticValue: { fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 16, marginTop: 3 },
  debugFootnote: { fontFamily: 'Inter_400Regular', fontSize: 9, lineHeight: 14, marginTop: 9 },
  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  reminderCard: { borderRadius: 20, padding: 15, flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  cardIcon: { height: 38, width: 38, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardContent: { flex: 1 },
  cardTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardTitleGroup: { flex: 1, paddingRight: 10 },
  reminderTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, lineHeight: 19 },
  placeName: { fontFamily: 'Inter_400Regular', fontSize: 11, marginTop: 3 },
  removeButton: { padding: 2 },
  cardMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 11 },
  metaPill: { flexDirection: 'row', gap: 5, alignItems: 'center', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },
  metaText: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  cardStatus: { fontFamily: 'Inter_500Medium', fontSize: 10 },
});