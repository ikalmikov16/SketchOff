# 🎨 SketchOff

A fun multiplayer drawing game built with React Native and Expo where players sketch, rate each other's artwork, and compete for the highest scores!

![Platform](https://img.shields.io/badge/platform-iOS%20%7C%20Android%20%7C%20Web-blue)
![Expo](https://img.shields.io/badge/Expo-54-000020)
![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB)

## ✨ Features

- **Real-time Multiplayer** - Create or join rooms with friends using room codes or QR codes (scanned with the device camera)
- **Cross-Platform** - Play on iOS, Android, or Web (drawing on mobile only)
- **In-App Drawing** - Draw directly on your device with a full-featured canvas
- **100+ Drawing Prompts** - Fun and creative topics across multiple categories
- **Live Scoring** - Rate drawings and see results in real-time
- **Sound Effects & Haptics** - Immersive feedback throughout the game
- **Offline Single-Device Mode** - Pass-the-phone gameplay when offline
- **Player Stats** - Track your game history and performance
- **Dark Theme** - Polished dark UI throughout

## 🎮 Game Modes

### 🌐 Multiplayer Mode

Each player uses their own device:

1. **Create a Room** - Set rounds (1-10) and time limit (30s - 5m)
2. **Share the Code** - Send the room code or let friends scan the QR code
3. **Draw** - Everyone draws the same prompt on their own device
4. **Rate** - View and rate each other's drawings (0-10 slider)
5. **Compete** - See round results and final standings

### 📱 Single Device Mode

Perfect for parties or when offline:

1. **Setup** - Add player names and configure settings
2. **Draw on Paper** - A topic is shown and everyone draws on paper
3. **Pass & Rate** - Pass the phone to rate each drawing
4. **Results** - See scores and final rankings

## 🛠 Tech Stack

| Technology | Purpose |
|------------|---------|
| **React Native** | Cross-platform mobile framework |
| **Expo SDK 54** | Development and build tooling |
| **Firebase Realtime Database** | Real-time game state sync |
| **Firebase Storage** | Drawing image storage |
| **Firebase Auth** | Anonymous authentication |
| **React Navigation 7** | Screen navigation |
| **react-native-signature-canvas** | Drawing canvas (WebView-based) |
| **Expo Haptics** | Tactile feedback |
| **Expo Audio** | Sound effects |

## 🚀 Getting Started

### Prerequisites

- [Bun](https://bun.sh) (package manager for this repo)
- Node.js 18+ (required by Expo tooling)
- [Expo Go](https://expo.dev/client) app on your device (for development)
- Firebase project with Realtime Database, Storage, and Auth enabled

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd sketchoff
   ```

2. **Install dependencies**
   ```bash
   bun install
   ```

3. **Configure Firebase**
   
   Create a `.env` file in the root directory:
   ```env
   EXPO_PUBLIC_FIREBASE_API_KEY=your_api_key
   EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
   EXPO_PUBLIC_FIREBASE_DATABASE_URL=your_database_url
   EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
   ```

4. **Deploy Firebase Rules**
   
   Copy the rules from `src/config/firebase.rules.json` and `src/config/storage.rules` to your Firebase console.

5. **Start the development server**
   ```bash
   bun start
   ```

6. **Run on your device**
   - Scan the QR code with Expo Go (iOS/Android)
   - Press `i` for iOS simulator
   - Press `a` for Android emulator
   - Press `w` for web browser

## 📁 Project Structure

```
sketchoff/
├── App.js                    # App entry point & navigation
├── app.json                  # Expo configuration
├── assets/
│   ├── images/               # App icons and splash screens
│   └── sounds/               # Game sound effects
└── src/
    ├── components/
    │   ├── DrawingGallery.js     # Gallery view for drawings
    │   ├── DrawingToolbar.js     # Color/brush selection toolbar
    │   ├── EnhancedDrawingCanvas.js  # Full-featured drawing canvas
    │   ├── NetworkStatus.js      # Offline banner & loading overlay
    │   ├── RatingCard.js         # Star rating component
    │   ├── TimerProgress.js      # Animated countdown timer
    │   ├── WheelPicker.js        # iOS-style wheel picker
    │   └── ZoomableImage.js      # Pinch-to-zoom image viewer
    ├── config/
    │   ├── firebase.js           # Firebase initialization
    │   ├── firebase.rules.json   # Realtime Database security rules
    │   └── storage.rules         # Storage security rules
    ├── context/
    │   ├── GameContext.js        # Single-device game state
    │   └── ThemeContext.js       # Light/dark theme provider
    ├── data/
    │   └── topics.js             # 100+ drawing prompts
    ├── screens/
    │   ├── WelcomeScreen.js      # Main menu
    │   ├── StatsScreen.js        # Player statistics
    │   │
    │   │ # Single Device Mode
    │   ├── SetupScreen.js        # Game setup
    │   ├── TopicScreen.js        # Drawing phase
    │   ├── RatingScreen.js       # Rating phase
    │   ├── RoundResultsScreen.js # Round results
    │   ├── FinalResultsScreen.js # Final standings
    │   │
    │   │ # Multiplayer Mode
    │   ├── RoomCreateScreen.js       # Create room
    │   ├── RoomJoinScreen.js         # Join room
    │   ├── LobbyScreen.js            # Game lobby
    │   ├── MultiplayerDrawingScreen.js   # Drawing phase
    │   ├── MultiplayerRatingScreen.js    # Rating phase
    │   ├── MultiplayerResultsScreen.js   # Round results
    │   └── MultiplayerFinalScreen.js     # Final standings
    └── utils/
        ├── haptics.js            # Haptic feedback helpers
        ├── network.js            # Network status monitoring
        ├── roomCleanup.js        # Stale room cleanup
        ├── sharing.js            # Share functionality
        ├── sounds.js             # Sound effect system
        └── storage.js            # Local storage helpers
```

## 🔧 Available Scripts

All scripts run through [Bun](https://bun.sh):

| Command | Description |
|---------|-------------|
| `bun start` | Start Expo development server |
| `bun run ios` | Run on iOS simulator |
| `bun run android` | Run on Android emulator |
| `bun run web` | Run in web browser |
| `bun run lint` | Run ESLint |
| `bun run format` | Format code with Prettier |
| `bun run format:check` | Check code formatting |
| `bun run test` | Run test suite |
| `bun run test:watch` | Run tests in watch mode |
| `bun run test:coverage` | Run tests with coverage report |

## 🧪 Testing

The project uses Jest with `jest-expo` for testing. Tests are located in the `__tests__/` directory.

```bash
# Run all tests
bun run test

# Run tests in watch mode during development
bun run test:watch

# Generate coverage report
bun run test:coverage
```

### Test Structure

```
__tests__/
├── __mocks__/              # Mock implementations
│   ├── asyncStorage.js     # AsyncStorage mock
│   └── firebase.js         # Firebase mock
├── components/             # Component tests
│   ├── RatingCard.test.js
│   └── TimerProgress.test.js
└── unit/                   # Unit tests
    ├── context/
    │   └── GameContext.test.js
    ├── data/
    │   └── topics.test.js
    └── utils/
        ├── roomCleanup.test.js
        ├── roomCode.test.js
        └── storage.test.js
```

## 🔗 Deep Linking

The app supports deep linking for easy room joining:

```
sketchoff://join/ROOMCODE
```

QR codes in the lobby automatically generate these links for quick joining.

## 🎨 Drawing Topics

The game includes 100+ creative prompts organized by category:
- 🐾 Animals (cats, dogs, dragons, etc.)
- 🧙 Fantasy & Imagination
- 🍕 Food & Drinks
- 🏠 Everyday Objects
- 🌴 Nature & Weather
- 🎭 Actions & Scenarios
- 🎬 Pop Culture
- ⚽ Sports & Activities

## 📱 Platform Support

| Feature | iOS | Android | Web |
|---------|-----|---------|-----|
| Multiplayer | ✅ | ✅ | ✅ |
| Drawing Canvas | ✅ | ✅ | ❌ |
| Rating | ✅ | ✅ | ✅ |
| Sound Effects | ✅ | ✅ | ✅ |
| Haptic Feedback | ✅ | ✅ | ❌ |
| QR Code Display (scan with camera) | ✅ | ✅ | ❌ |
| Share Results | ✅ | ✅ | ✅ |

> **Note:** Web users can participate by skipping the drawing phase (submitting a placeholder) while still being able to rate and view results.

## 🔐 Firebase Security

The app uses Firebase security rules to ensure:
- Players can only modify their own data
- Room hosts have special privileges
- Drawings are validated before storage
- Stale rooms are automatically cleaned up

See `src/config/firebase.rules.json` and `src/config/storage.rules` for the full rules.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 🔒 Security

Found a security vulnerability? Please see [SECURITY.md](SECURITY.md) for responsible disclosure guidelines.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

Made with ❤️ and lots of doodles
