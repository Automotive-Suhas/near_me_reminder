/**
 * Semantic light and dark design tokens for NearMe Reminder.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#183B34',
    tint: '#D86F54',

    // Core surfaces
    background: '#F4F3EE',
    foreground: '#183B34',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#183B34',

    // Primary action color (buttons, links, active states)
    primary: '#D86F54',
    primaryForeground: '#ffffff',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#E7EAE3',
    secondaryForeground: '#25443C',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#ECEDE7',
    mutedForeground: '#74817A',

    // Accent highlights (badges, selected items, focus rings)
    accent: '#F5E8DC',
    accentForeground: '#713D2E',

    // Destructive actions (delete, error states)
    destructive: '#B7463B',
    destructiveForeground: '#ffffff',

    // Borders and input outlines
    border: '#DCE1DA',
    input: '#DCE1DA',
  },

  dark: {
    text: '#E9F0E9',
    tint: '#E48A6F',
    background: '#14251F',
    foreground: '#E9F0E9',
    card: '#1D322A',
    cardForeground: '#E9F0E9',
    primary: '#E48A6F',
    primaryForeground: '#1F2924',
    secondary: '#293D34',
    secondaryForeground: '#DCE9DF',
    muted: '#293D34',
    mutedForeground: '#A5B2A8',
    accent: '#47362E',
    accentForeground: '#F2C3AF',
    destructive: '#E7786B',
    destructiveForeground: '#241B19',
    border: '#354A40',
    input: '#354A40',
  },

  // Shared radius for cards, buttons, and inputs.
  radius: 18,
};

export default colors;
