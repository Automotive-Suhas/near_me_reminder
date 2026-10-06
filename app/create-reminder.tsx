import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { useColors } from '@/hooks/useColors';
import { addReminder, getReminder, removeReminder, updateReminder } from '@/src/reminderStore';
import {
  PermissionSetupError,
  requestMonitoringPermissions,
  requestForegroundLocationPermission,
  geofenceManager,
} from '@/src/geofencing';

const RADIUS_PRESETS = [100, 200, 300, 500];

type PlaceSearchResult = {
  location: Location.LocationGeocodedLocation;
  label: string;
};

export default function CreateReminderScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const editingId = typeof params.id === 'string' ? params.id : undefined;
  const editing = Boolean(editingId);
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState('200');
  const [activeFrom, setActiveFrom] = useState('00:00');
  const [activeTo, setActiveTo] = useState('23:59');
  const [gettingLocation, setGettingLocation] = useState(false);
  const [searchingPlace, setSearchingPlace] = useState(false);
  const [placeResults, setPlaceResults] = useState<PlaceSearchResult[]>([]);
  const [loadingReminder, setLoadingReminder] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editingId) return;
    void (async () => {
      try {
        const existing = await getReminder(editingId);
        if (!existing) {
          Alert.alert('Reminder not found', 'This reminder no longer exists.');
          router.back();
          return;
        }
        setTitle(existing.title);
        setPlaceName(existing.placeName);
        setLatitude(existing.latitude.toFixed(6));
        setLongitude(existing.longitude.toFixed(6));
        setRadius(String(existing.radiusMeters));
        setActiveFrom(existing.activeFrom);
        setActiveTo(existing.activeTo);
      } catch (error) {
        Alert.alert('Could not load reminder', error instanceof Error ? error.message : 'Please try again.');
        router.back();
      } finally {
        setLoadingReminder(false);
      }
    })();
  }, [editingId, router]);

  const searchPlace = async () => {
    const query = placeName.trim();
    if (!query) {
      Alert.alert('Enter a place', 'Type a place name or address first.');
      return;
    }
    setSearchingPlace(true);
    try {
      if (Platform.OS === 'android') {
        await requestForegroundLocationPermission();
      }
      const results = await Location.geocodeAsync(query);
      if (!results.length) {
        setPlaceResults([]);
        Alert.alert('Place not found', 'Try a more specific place name or address.');
        return;
      }
      const placeResults = await Promise.all(
        results.slice(0, 3).map(async (location) => {
          try {
            const addresses = await Location.reverseGeocodeAsync({
              latitude: location.latitude,
              longitude: location.longitude,
            });
            const address = addresses[0];
            const label = address?.formattedAddress ||
              [address?.name, address?.street, address?.city, address?.region, address?.country]
                .filter((part, index, array) => Boolean(part) && array.indexOf(part) === index)
                .join(', ') ||
              `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
            return { location, label };
          } catch {
            return {
              location,
              label: `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`,
            };
          }
        }),
      );
      setPlaceResults(placeResults);
    } catch (error) {
      Alert.alert('Could not search place', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSearchingPlace(false);
    }
  };

  const selectPlace = (result: PlaceSearchResult) => {
    setPlaceName(result.label || placeName.trim());
    setLatitude(result.location.latitude.toFixed(6));
    setLongitude(result.location.longitude.toFixed(6));
    setPlaceResults([]);
    Keyboard.dismiss();
  };

  const useCurrentLocation = async () => {
    if (Platform.OS !== 'android') {
      Alert.alert(
        'Android device required',
        'Current location and geofence monitoring are available in the Android app.',
      );
      return;
    }
    setGettingLocation(true);
    try {
      await requestForegroundLocationPermission();
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setLatitude(position.coords.latitude.toFixed(6));
      setLongitude(position.coords.longitude.toFixed(6));
    } catch (error) {
      const needsSettings =
        error instanceof PermissionSetupError &&
        error.permission !== 'location-services';
      Alert.alert(
        error instanceof PermissionSetupError
          ? error.permission === 'location-services'
            ? 'Turn on device Location'
            : 'Location permission needed'
          : 'Could not get location',
        error instanceof Error ? error.message : 'Check that location services are on.',
        needsSettings
          ? [
              { text: 'Not now', style: 'cancel' },
              {
                text: 'Open app settings',
                onPress: () => void Linking.openSettings(),
              },
            ]
          : undefined,
      );
    } finally {
      setGettingLocation(false);
    }
  };

  const save = async () => {
    Keyboard.dismiss();
    const cleanTitle = title.trim();
    const cleanPlace = placeName.trim();
    const lat = Number(latitude);
    const lon = Number(longitude);
    const radiusMeters = Number(radius);

    if (!cleanTitle || !cleanPlace) {
      Alert.alert('Add a reminder and place', 'Both the reminder and place name are required.');
      return;
    }
    if (
      !latitude.trim() ||
      !longitude.trim() ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180
    ) {
      Alert.alert('Check the coordinates', 'Enter a valid latitude and longitude, or use your current location.');
      return;
    }
    if (!Number.isInteger(radiusMeters) || radiusMeters < 100 || radiusMeters > 5000) {
      Alert.alert('Check the radius', 'Choose a whole number between 100 and 5,000 meters.');
      return;
    }
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
    if (!timePattern.test(activeFrom) || !timePattern.test(activeTo)) {
      Alert.alert('Check active hours', 'Use 24-hour time such as 08:00 or 21:30.');
      return;
    }


    setSaving(true);
    let createdId: string | undefined;
    try {
      await requestMonitoringPermissions();
      const reminder = editingId
        ? await updateReminder(editingId, {
            title: cleanTitle,
            placeName: cleanPlace,
            latitude: lat,
            longitude: lon,
            radiusMeters,
            activeFrom,
            activeTo,
            active: true,
            triggeredAt: null,
          })
        : await addReminder({
            title: cleanTitle,
            placeName: cleanPlace,
            latitude: lat,
            longitude: lon,
            radiusMeters,
            activeFrom,
            activeTo,
          });
      if (!reminder) throw new Error('This reminder no longer exists.');
      createdId = editingId ? undefined : reminder.id;
      const ready = await geofenceManager.registerGeofence(reminder.id);
      if (!ready) {
        throw new Error(
          'Android could not register this geofence. Check that device Location and background location are enabled, then try again.',
        );
      }
      createdId = undefined;
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (error) {
      let saveMessage =
        error instanceof Error ? error.message : 'Please try again.';
      if (createdId) {
        try {
          await removeReminder(createdId);
          await geofenceManager.synchronizeActiveReminders();
        } catch (rollbackError) {
          saveMessage += ` The reminder may still be saved: ${
            rollbackError instanceof Error
              ? rollbackError.message
              : 'could not restore the previous geofences'
          }.`;
        }
      }
      if (error instanceof PermissionSetupError) {
        const needsSettings =
          error.permission !== 'location-services' &&
          error.permission !== 'unavailable';
        Alert.alert(
          error.permission === 'location-services'
            ? 'Turn on device Location'
            : 'Permission needed',
          error.message,
          needsSettings
            ? [
                { text: 'Not now', style: 'cancel' },
                {
                  text: 'Open app settings',
                  onPress: () => void Linking.openSettings(),
                },
              ]
            : undefined,
        );
      } else {
        Alert.alert(
          'Reminder not saved',
          saveMessage,
        );
      }
    } finally {
      setSaving(false);
    }
  };

  if (loadingReminder) {
    return <View style={[styles.screen, { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }]}><ActivityIndicator color={colors.primary} /></View>;
  }

  const webTop = Platform.OS === 'web' ? 67 : 10;
  const webBottom = Platform.OS === 'web' ? 34 : 16;

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={[styles.topBar, { paddingTop: insets.top + webTop }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={[styles.backButton, { backgroundColor: colors.card }]}
        >
          <Feather name="arrow-left" size={19} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.topLabel, { color: colors.mutedForeground }]}>
          {editing ? 'EDIT REMINDER' : 'NEW REMINDER'}
        </Text>
        <View style={styles.topSpacer} />
      </View>

      <KeyboardAwareScrollViewCompat
        style={styles.scroll}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + webBottom },
        ]}
        bottomOffset={74}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.introIcon, { backgroundColor: colors.accent }]}>
          <Feather name="map-pin" size={22} color={colors.accentForeground} />
        </View>
        <Text style={[styles.heading, { color: colors.foreground }]}>
          {editing ? 'Update your reminder' : <>What should we{'\n'}remind you about?</>}
        </Text>
        <Text style={[styles.subheading, { color: colors.mutedForeground }]}>
          You’ll get one notification when you enter the area.
        </Text>

        <FieldLabel label="REMINDER" colors={colors} />
        <TextInput
          accessibilityLabel="Reminder"
          testID="reminder-title"
          value={title}
          onChangeText={setTitle}
          placeholder="e.g. Don't forget your ID card"
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="next"
          maxLength={100}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />

        <FieldLabel label="PLACE NAME" colors={colors} />
        <TextInput
          accessibilityLabel="Place name"
          testID="place-name"
          value={placeName}
          onChangeText={setPlaceName}
          placeholder="e.g. Westside Pharmacy"
          placeholderTextColor={colors.mutedForeground}
          returnKeyType="next"
          maxLength={80}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
        />
        <Pressable
          accessibilityRole="button"
          testID="search-place"
          onPress={() => void searchPlace()}
          disabled={searchingPlace}
          style={[styles.searchPlaceButton, { backgroundColor: colors.secondary, borderColor: colors.border }]}
        >
          <Feather name="search" size={14} color={colors.secondaryForeground} />
          <Text style={[styles.searchPlaceText, { color: colors.secondaryForeground }]}>
            {searchingPlace ? 'Searching…' : 'Search place'}
          </Text>
        </Pressable>
        {placeResults.length > 0 && (
          <View style={[styles.placeResults, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {placeResults.map((result, index) => (
              <Pressable key={`${result.label}-${index}`} onPress={() => selectPlace(result)} style={styles.placeResult}>
                <Feather name="map-pin" size={14} color={colors.primary} />
                <Text style={[styles.placeResultText, { color: colors.foreground }]} numberOfLines={2}>
                  {result.label}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={styles.locationHeading}>
          <FieldLabel label="LOCATION COORDINATES" colors={colors} />
          <Pressable
            accessibilityRole="button"
            testID="use-current-location"
            disabled={gettingLocation}
            onPress={() => void useCurrentLocation()}
            style={styles.currentLocation}
          >
            <Feather name="crosshair" size={13} color={colors.primary} />
            <Text style={[styles.currentLocationText, { color: colors.primary }]}>
              {gettingLocation ? 'Locating…' : 'Use current location'}
            </Text>
          </Pressable>
        </View>
        <View style={styles.coordinateRow}>
          <TextInput
            accessibilityLabel="Latitude"
            testID="latitude"
            value={latitude}
            onChangeText={setLatitude}
            placeholder="Latitude"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numbers-and-punctuation"
            returnKeyType="next"
            style={[styles.input, styles.coordinateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />
          <TextInput
            accessibilityLabel="Longitude"
            testID="longitude"
            value={longitude}
            onChangeText={setLongitude}
            placeholder="Longitude"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="numbers-and-punctuation"
            returnKeyType="done"
            style={[styles.input, styles.coordinateInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
          />
        </View>
        <Text style={[styles.helper, { color: colors.mutedForeground }]}>
          You can enter coordinates or fill these from where you are now.
        </Text>

        <View style={styles.radiusHeading}>
          <FieldLabel label="ALERT DISTANCE" colors={colors} />
          <View style={styles.radiusValue}>
            <TextInput
              accessibilityLabel="Radius in meters"
              testID="radius"
              value={radius}
              onChangeText={setRadius}
              keyboardType="number-pad"
              maxLength={4}
              selectTextOnFocus
              style={[styles.radiusInput, { color: colors.foreground }]}
            />
            <Text style={[styles.radiusUnit, { color: colors.mutedForeground }]}>meters</Text>
          </View>
        </View>
        <View style={styles.radiusChoices}>
          {RADIUS_PRESETS.map((meters) => {
            const selected = radius === String(meters);
            return (
              <Pressable
                key={meters}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setRadius(String(meters))}
                style={[
                  styles.radiusChoice,
                  {
                    backgroundColor: selected ? colors.foreground : colors.card,
                    borderColor: selected ? colors.foreground : colors.border,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.radiusChoiceText,
                    { color: selected ? colors.background : colors.foreground },
                  ]}
                >
                  {meters} m
                </Text>
              </Pressable>
            );
          })}
        </View>

        <FieldLabel label="ACTIVE HOURS" colors={colors} />
        <Text style={[styles.helper, { color: colors.mutedForeground, marginBottom: 8 }]}>Only trigger this reminder when you enter the area during these hours. Overnight ranges such as 22:00–06:00 are supported.</Text>
        <View style={styles.timeRow}>
          <View style={styles.timeField}>
            <Text style={[styles.timeCaption, { color: colors.mutedForeground }]}>FROM</Text>
            <TextInput accessibilityLabel="Active from" value={activeFrom} onChangeText={setActiveFrom} placeholder="08:00" keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, styles.timeInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} />
          </View>
          <View style={styles.timeField}>
            <Text style={[styles.timeCaption, { color: colors.mutedForeground }]}>TO</Text>
            <TextInput accessibilityLabel="Active to" value={activeTo} onChangeText={setActiveTo} placeholder="20:00" keyboardType="numbers-and-punctuation" maxLength={5} style={[styles.input, styles.timeInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]} />
          </View>
        </View>

        <View style={[styles.privacyNote, { backgroundColor: colors.secondary }]}>
          <Feather name="battery-charging" size={16} color={colors.secondaryForeground} />
          <Text style={[styles.privacyText, { color: colors.secondaryForeground }]}>
            Android geofencing monitors this area in the background; the app does not continuously track GPS.
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          testID="save-reminder"
          disabled={saving}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.saveButton,
            {
              backgroundColor: colors.primary,
              opacity: saving ? 0.62 : pressed ? 0.84 : 1,
            },
          ]}
        >
          <Text style={[styles.saveButtonText, { color: colors.primaryForeground }]}>
            {saving ? 'Setting up…' : editing ? 'Save changes' : 'Save reminder'}
          </Text>
          <Feather name="arrow-right" size={17} color={colors.primaryForeground} />
        </Pressable>
        <Text style={[styles.permissionFootnote, { color: colors.mutedForeground }]}>
          NearMe explains each permission before Android asks. Verify background geofencing in a native Android development build; browser and Expo Go previews do not prove delivery.
        </Text>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

function FieldLabel({
  label,
  colors,
}: {
  label: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  topBar: { paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', minHeight: 58 },
  backButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  topLabel: { flex: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.8 },
  topSpacer: { width: 40 },
  scroll: { flex: 1 },
  content: { paddingHorizontal: 22, paddingTop: 20 },
  introIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 27, lineHeight: 32, letterSpacing: -0.8 },
  subheading: { fontFamily: 'Inter_400Regular', fontSize: 12, lineHeight: 18, marginTop: 8, marginBottom: 24 },
  fieldLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 9, letterSpacing: 1.3, marginBottom: 8 },
  input: { minHeight: 49, borderWidth: 1, borderRadius: 15, paddingHorizontal: 14, fontFamily: 'Inter_400Regular', fontSize: 13, marginBottom: 17 },
  locationHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 1 },
  searchPlaceButton: { minHeight: 38, borderRadius: 12, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: -8, marginBottom: 12 },
  searchPlaceText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  placeResults: { borderRadius: 14, borderWidth: 1, marginTop: -7, marginBottom: 14, overflow: 'hidden' },
  placeResult: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: '#E6E2DA' },
  placeResultText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 11, lineHeight: 15 },
  timeRow: { flexDirection: 'row', gap: 10, marginBottom: 6 },
  timeField: { flex: 1 },
  timeCaption: { fontFamily: 'Inter_600SemiBold', fontSize: 8, letterSpacing: 1.1, marginBottom: 5 },
  timeInput: { marginBottom: 12, textAlign: 'center' },
  currentLocation: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  currentLocationText: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  coordinateRow: { flexDirection: 'row', gap: 10 },
  coordinateInput: { flex: 1, minWidth: 0 },
  helper: { fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15, marginTop: -10, marginBottom: 18 },
  radiusHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  radiusValue: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 8 },
  radiusInput: { minWidth: 34, padding: 0, textAlign: 'right', fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  radiusUnit: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  radiusChoices: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  radiusChoice: { minHeight: 34, minWidth: 59, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  radiusChoiceText: { fontFamily: 'Inter_500Medium', fontSize: 10 },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 15, padding: 12, marginBottom: 18 },
  privacyText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 10, lineHeight: 15 },
  saveButton: { minHeight: 52, borderRadius: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  saveButtonText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  permissionFootnote: { textAlign: 'center', fontFamily: 'Inter_400Regular', fontSize: 9, marginTop: 10 },
});