# BikSAFE

BikSAFE is a phone-first traffic awareness web app for bikes and handlebars. It uses the phone camera plus TensorFlow.js object detection to watch for nearby vehicles and show simple danger, warning, and safe states for traffic in front of or behind the rider.

## What it does

- Front mode for traffic ahead
- Rear mode for handlebar mirror-style viewing
- Bounding boxes and danger feedback for cars, trucks, buses, motorcycles, and bicycles
- Adjustable distance zones in meters and approximate car lengths
- Audio and haptic alerts on supported phones

## Main files

- `index.html`: app shell and mobile HUD
- `styles.css`: phone-focused layout and settings sheet styling
- `src/app.js`: app wiring, mode switching, settings, and runtime flow
- `src/detector.js`: detection, tracking, distance estimation, and zone logic
- `src/preferences.js`: saved settings and threshold persistence
- `src/settings-panel.js`: settings overlay behavior

## Running locally

This project is static and can be opened from a simple local web server.

Example:

```bash
python -m http.server 8000
```

Then open the site in a mobile browser and allow camera access.

## Notes

Distance estimates are approximate. The app currently infers distance from detected vehicle size in the camera frame, so real-world tuning on the target phone and camera position is important before relying on it in motion.
